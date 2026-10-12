// core/transcribe.ts — the transcription seam for voicemail (docs/IVR-VOICEMAIL-BRIEF.md step 2).
//
// Mirrors core/classify.ts's provider seam on purpose: an interface the screens/writers never
// care about the implementation of, a deterministic no-op default, and a fail-CLOSED unknown
// name rather than a silent fallback to something unapproved.
//
// The brief's own finding is why the default does nothing: "The language is the hard part, not
// the audio" — parents leave messages in Gujarati, Hindi, English and mixes of all three, and
// the brief gates any real provider on the SAME five-recording test regardless of which route
// is chosen. The "google" provider below is wired in ahead of that test, on VK's own explicit
// instruction (03-Sep-2026: "I have Google Cloud STT keys") rather than by a default guess —
// note this so a later reader does not mistake it for the gate having been skipped quietly.
// The five-recording test is still worth running against what this actually produces.
//
// "Whatever we choose, transcription failure must never lose the call" (brief step 2) is the
// reason `transcribe` returns `null` rather than throwing on anything it cannot handle — the
// caller (app/api/voicemail/route.ts) always creates the record either way, audio attached,
// marked needs-a-listen when this returns null.
//
// Network I/O in `core/` is a deliberate, precedented exception to the pure-core rule (cardinal
// rule 1): core/classify-model.ts's model provider already calls `fetch` directly from here,
// with the client injectable (`fetchImpl`) so the test suite never touches the network. This
// follows the same shape rather than inventing a second one under lib/.

export interface TranscribeInput {
  audio: Buffer;
  contentType: string;
  durationSeconds: number;
}

export interface Transcript {
  text: string;
  confidence: 'high' | 'low';
  /** Which provider produced this — carried onto the record's provenance, never guessed later. */
  provider: string;
}

export interface Transcriber {
  readonly name: string;
  /** Null means "could not transcribe" — wrong language, too noisy, silence, or simply not
   *  wired yet. Never throws for an ordinary failure; a caller that wants network/parse errors
   *  visible catches around the call, but a bad recording is not an exceptional case. */
  transcribe(input: TranscribeInput): Promise<Transcript | null>;
}

/** The default and, as of this writing, only registered provider: does nothing, on purpose. */
export const noneTranscriber: Transcriber = {
  name: 'none',
  async transcribe() {
    return null;
  },
};

const GOOGLE_STT_URL = 'https://speech.googleapis.com/v1/speech:recognize';
const GOOGLE_STT_TIMEOUT_MS = 20_000;

export interface GoogleSttConfig {
  apiKey?: string;
  /** BCP-47 codes. Brief step 2's own recommendation: `gu-IN, hi-IN, en-IN` — chosen because a
   *  real family of Fountainhead voicemails mixes exactly those three, not a generic default. */
  languageCode?: string;
  alternativeLanguageCodes?: string[];
  /** Explicit override for a content type encodingFor() cannot place. Leave unset for WAV/FLAC
   *  — Google reads the container's own header for those two, and a wrong guess here fails the
   *  whole call where no guess at all lets the header speak for itself. */
  encoding?: string;
  sampleRateHertz?: number;
  /** Injectable for tests — no network in the suite (same shape as classify-model.ts). */
  fetchImpl?: typeof fetch;
}

export function googleSttConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): GoogleSttConfig {
  const alt = (env.GOOGLE_STT_ALT_LANGUAGES ?? 'hi-IN,gu-IN').split(',').map(s => s.trim()).filter(Boolean);
  return {
    apiKey: env.GOOGLE_STT_API_KEY,
    languageCode: env.GOOGLE_STT_LANGUAGE || 'en-IN',
    alternativeLanguageCodes: alt,
    encoding: env.GOOGLE_STT_ENCODING || undefined,
    sampleRateHertz: env.GOOGLE_STT_SAMPLE_RATE_HZ ? Number(env.GOOGLE_STT_SAMPLE_RATE_HZ) : undefined,
  };
}

/**
 * A contentType → Google encoding enum guess. Deliberately returns undefined for WAV and FLAC:
 * Google can read encoding + sample rate straight out of those two containers' own headers, and
 * a WRONG guess here fails the whole recognise call — an honest "let the header speak" beats a
 * confident wrong one. Everything else needs an explicit hint or it will not recognise at all,
 * which is exactly the vendor question the brief's own step 1 leaves open ("Audio format —
 * please tell us what we will get").
 */
function encodingFor(contentType: string): string | undefined {
  const t = contentType.toLowerCase();
  if (t.includes('wav') || t.includes('flac')) return undefined;
  if (t.includes('mpeg') || t.includes('mp3')) return 'MP3';
  if (t.includes('ogg')) return 'OGG_OPUS';
  if (t.includes('linear16') || t.includes('l16') || t.includes('pcm')) return 'LINEAR16';
  return undefined;
}

interface GoogleSttResponse {
  results?: Array<{ alternatives?: Array<{ transcript?: string; confidence?: number }> }>;
}

/**
 * Google Cloud Speech-to-Text, wired via the plain API-key `speech:recognize` REST call rather
 * than the `@google-cloud/speech` client library — the same "lean beats convenient" call
 * lib/ingest/gmail.ts's own header comment made about `googleapis`, and this is one endpoint,
 * not four.
 */
export function makeGoogleSttTranscriber(cfg: GoogleSttConfig): Transcriber {
  const doFetch = cfg.fetchImpl ?? fetch;
  return {
    name: 'google',
    async transcribe(input) {
      // Not configured — never lose the call over it, just decline to transcribe.
      if (!cfg.apiKey) return null;

      const encoding = cfg.encoding ?? encodingFor(input.contentType);
      const config: Record<string, unknown> = {
        languageCode: cfg.languageCode || 'en-IN',
        alternativeLanguageCodes: cfg.alternativeLanguageCodes,
        enableAutomaticPunctuation: true,
      };
      if (encoding) config.encoding = encoding;
      if (cfg.sampleRateHertz) config.sampleRateHertz = cfg.sampleRateHertz;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), GOOGLE_STT_TIMEOUT_MS);
      try {
        const res = await doFetch(`${GOOGLE_STT_URL}?key=${encodeURIComponent(cfg.apiKey)}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ config, audio: { content: input.audio.toString('base64') } }),
          signal: controller.signal,
        });
        if (!res.ok) return null; // an ordinary transcription failure, not an exceptional one

        const json = (await res.json()) as GoogleSttResponse;
        const alts = (json.results ?? [])
          .map(r => r.alternatives?.[0])
          .filter((a): a is { transcript?: string; confidence?: number } => Boolean(a?.transcript));
        if (alts.length === 0) return null; // silence, noise, or nothing recognisable

        const text = alts.map(a => a.transcript!.trim()).join(' ').trim();
        const avgConfidence = alts.reduce((s, a) => s + (a.confidence ?? 0), 0) / alts.length;
        return { text, confidence: avgConfidence >= 0.8 ? 'high' : 'low', provider: 'google' };
      } catch {
        return null; // timeout, network error, malformed response — same outcome as "could not transcribe"
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

// ---------------------------------------------------------------------------------------
// OpenAI Whisper — chosen by Pradip 12-Oct-2026 for the real vendor recordings: they are
// code-switched Gujarati / Hindi / English phone calls, the case Whisper handles best of the
// routes the brief listed. The language is deliberately NOT pinned: a pinned language forces
// translation of every other one, and these calls switch mid-sentence.
// ---------------------------------------------------------------------------------------

const WHISPER_URL = 'https://api.openai.com/v1/audio/transcriptions';
const WHISPER_PROMPT =
  'Phone call to a school front desk in Surat, India. Speakers mix Gujarati, Hindi and English.';

export interface WhisperConfig {
  apiKey?: string;
  model?: string;
  fetchImpl?: typeof fetch;
}

export function whisperConfigFromEnv(env: Record<string, string | undefined> = process.env): WhisperConfig {
  return { apiKey: env.OPENAI_API_KEY, model: env.OPENAI_TRANSCRIBE_MODEL || 'whisper-1' };
}

export type WhisperResult =
  | { ok: true; text: string; language: string | null; durationSeconds: number | null }
  | { ok: false; reason: string };

/** The detailed call, reporting WHY it failed — the dashboard shows that reason. */
export async function transcribeWithWhisper(cfg: WhisperConfig, input: TranscribeInput): Promise<WhisperResult> {
  if (!cfg.apiKey) return { ok: false, reason: 'OPENAI_API_KEY is not set' };
  const doFetch = cfg.fetchImpl ?? fetch;
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(input.audio)], { type: input.contentType || 'audio/mpeg' }), 'call.mp3');
  form.append('model', cfg.model || 'whisper-1');
  form.append('response_format', 'verbose_json');
  form.append('prompt', WHISPER_PROMPT);
  try {
    const res = await doFetch(WHISPER_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${cfg.apiKey}` },
      body: form,
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 200);
      return { ok: false, reason: `OpenAI HTTP ${res.status}${detail ? `: ${detail}` : ''}` };
    }
    const j = (await res.json()) as { text?: string; language?: string; duration?: number };
    const text = (j.text ?? '').trim();
    if (!text) return { ok: false, reason: 'no speech recognised' };
    return {
      ok: true, text, language: j.language ?? null,
      durationSeconds: typeof j.duration === 'number' ? Math.round(j.duration) : null,
    };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

export function makeWhisperTranscriber(cfg: WhisperConfig): Transcriber {
  return {
    name: 'openai',
    async transcribe(input) {
      const r = await transcribeWithWhisper(cfg, input);
      return r.ok ? { text: r.text, confidence: 'high', provider: 'openai' } : null;
    },
  };
}

export function getTranscriber(name = process.env.TRANSCRIBER ?? 'none'): Transcriber {
  if (name === 'none') return noneTranscriber;
  if (name === 'google') return makeGoogleSttTranscriber(googleSttConfigFromEnv());
  if (name === 'openai') return makeWhisperTranscriber(whisperConfigFromEnv());
  // Any OTHER provider registers here once it has passed the five-recording test the brief asks
  // for. Failing closed is deliberate: an unrecognised name must never silently send a parent's
  // voicemail to an unapproved or untested transcription service.
  throw new Error(
    `Unknown transcriber "${name}". Available: "none", "google", "openai" — see docs/IVR-VOICEMAIL-BRIEF.md `
    + 'step 2 for the remaining candidate routes and the test each must pass before it is wired in here.',
  );
}
