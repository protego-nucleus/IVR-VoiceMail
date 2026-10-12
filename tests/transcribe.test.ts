import { describe, it, expect, vi } from 'vitest';
import {
  getTranscriber, googleSttConfigFromEnv, makeGoogleSttTranscriber, noneTranscriber,
} from '../core/transcribe';

describe('getTranscriber — fails closed, mirroring core/classify.ts', () => {
  it('defaults to "none", which always returns null', async () => {
    const t = getTranscriber();
    expect(t.name).toBe('none');
    await expect(t.transcribe({ audio: Buffer.from(''), contentType: 'audio/wav', durationSeconds: 10 }))
      .resolves.toBeNull();
  });

  it('the "none" provider never throws, whatever it is given', async () => {
    await expect(
      noneTranscriber.transcribe({ audio: Buffer.alloc(0), contentType: '', durationSeconds: 0 }),
    ).resolves.toBeNull();
  });

  it('an unregistered provider name fails closed instead of silently falling back', () => {
    expect(() => getTranscriber('google-stt')).toThrow(/Unknown transcriber/);
  });

  it('"google" IS registered (VK, 03-Sep-2026: wired ahead of the five-recording test)', () => {
    expect(getTranscriber('google').name).toBe('google');
  });
});

describe('googleSttConfigFromEnv', () => {
  it('defaults to the brief\'s own recommended language family', () => {
    const cfg = googleSttConfigFromEnv({});
    expect(cfg.languageCode).toBe('en-IN');
    expect(cfg.alternativeLanguageCodes).toEqual(['hi-IN', 'gu-IN']);
    expect(cfg.apiKey).toBeUndefined();
  });

  it('reads every var when set', () => {
    const cfg = googleSttConfigFromEnv({
      GOOGLE_STT_API_KEY: 'k', GOOGLE_STT_LANGUAGE: 'hi-IN',
      GOOGLE_STT_ALT_LANGUAGES: 'en-IN, gu-IN', GOOGLE_STT_SAMPLE_RATE_HZ: '8000',
    });
    expect(cfg).toMatchObject({
      apiKey: 'k', languageCode: 'hi-IN', alternativeLanguageCodes: ['en-IN', 'gu-IN'],
      sampleRateHertz: 8000,
    });
  });
});

describe('makeGoogleSttTranscriber — network injected, no real calls in the suite', () => {
  const audio = Buffer.from('fake wav bytes');

  it('declines to transcribe when no API key is configured — never throws, never loses the call', async () => {
    const t = makeGoogleSttTranscriber({});
    await expect(t.transcribe({ audio, contentType: 'audio/wav', durationSeconds: 12 })).resolves.toBeNull();
  });

  it('parses a successful recognise response into one joined transcript', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      results: [
        { alternatives: [{ transcript: 'My daughter is sick today', confidence: 0.92 }] },
        { alternatives: [{ transcript: 'and will not be coming to school.', confidence: 0.88 }] },
      ],
    }), { status: 200 })) as unknown as typeof fetch;

    const t = makeGoogleSttTranscriber({ apiKey: 'k', fetchImpl });
    const result = await t.transcribe({ audio, contentType: 'audio/wav', durationSeconds: 12 });
    expect(result).toEqual({
      text: 'My daughter is sick today and will not be coming to school.',
      confidence: 'high',
      provider: 'google',
    });
  });

  it('a low average confidence is reported as "low", not silently rounded up', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      results: [{ alternatives: [{ transcript: 'unclear mumbling', confidence: 0.4 }] }],
    }), { status: 200 })) as unknown as typeof fetch;

    const result = await makeGoogleSttTranscriber({ apiKey: 'k', fetchImpl })
      .transcribe({ audio, contentType: 'audio/wav', durationSeconds: 5 });
    expect(result?.confidence).toBe('low');
  });

  it('an HTTP error is a null, not a throw — an ordinary transcription failure', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 500 })) as unknown as typeof fetch;
    await expect(
      makeGoogleSttTranscriber({ apiKey: 'k', fetchImpl }).transcribe({ audio, contentType: 'audio/wav', durationSeconds: 5 }),
    ).resolves.toBeNull();
  });

  it('no results at all (silence) is a null, not an empty-string transcript', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ results: [] }), { status: 200 })) as unknown as typeof fetch;
    await expect(
      makeGoogleSttTranscriber({ apiKey: 'k', fetchImpl }).transcribe({ audio, contentType: 'audio/wav', durationSeconds: 5 }),
    ).resolves.toBeNull();
  });

  it('a network throw resolves to null rather than propagating', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('ECONNRESET'); }) as unknown as typeof fetch;
    await expect(
      makeGoogleSttTranscriber({ apiKey: 'k', fetchImpl }).transcribe({ audio, contentType: 'audio/wav', durationSeconds: 5 }),
    ).resolves.toBeNull();
  });

  it('never guesses an encoding for WAV/FLAC — lets Google read the container header', async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      expect(body.config.encoding).toBeUndefined();
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    }) as unknown as typeof fetch;
    await makeGoogleSttTranscriber({ apiKey: 'k', fetchImpl })
      .transcribe({ audio, contentType: 'audio/wav', durationSeconds: 5 });
    expect(fetchImpl).toHaveBeenCalled();
  });

  it('maps a known non-WAV content type to its Google encoding enum', async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      expect(body.config.encoding).toBe('MP3');
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    }) as unknown as typeof fetch;
    await makeGoogleSttTranscriber({ apiKey: 'k', fetchImpl })
      .transcribe({ audio, contentType: 'audio/mpeg', durationSeconds: 5 });
  });

  it('sends the brief\'s own recommended language family by default', async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      expect(body.config.languageCode).toBe('en-IN');
      expect(body.config.alternativeLanguageCodes).toEqual(['hi-IN', 'gu-IN']);
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    }) as unknown as typeof fetch;
    await makeGoogleSttTranscriber({ ...googleSttConfigFromEnv({}), apiKey: 'k', fetchImpl })
      .transcribe({ audio, contentType: 'audio/wav', durationSeconds: 5 });
  });
});

import { transcribeWithWhisper } from '../core/transcribe';

describe('transcribeWithWhisper — network injected', () => {
  const input = { audio: Buffer.from('x'), contentType: 'audio/mpeg', durationSeconds: 10 };

  it('refuses without a key, saying why', async () => {
    expect(await transcribeWithWhisper({}, input)).toEqual({ ok: false, reason: 'OPENAI_API_KEY is not set' });
  });

  it('returns text, language and duration, and never pins a language', async () => {
    let sent: FormData | null = null;
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      sent = init.body as FormData;
      return new Response(JSON.stringify({ text: ' Mari dikri bimar che. ', language: 'gujarati', duration: 41.6 }), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await transcribeWithWhisper({ apiKey: 'k', fetchImpl }, input);
    expect(r).toEqual({ ok: true, text: 'Mari dikri bimar che.', language: 'gujarati', durationSeconds: 42 });
    expect(sent!.get('language')).toBeNull();
    expect(sent!.get('response_format')).toBe('verbose_json');
  });

  it('reports the HTTP status on an API error', async () => {
    const fetchImpl = (async () => new Response('quota exceeded', { status: 429 })) as unknown as typeof fetch;
    const r = await transcribeWithWhisper({ apiKey: 'k', fetchImpl }, input);
    expect(r).toEqual({ ok: false, reason: 'OpenAI HTTP 429: quota exceeded', retryAfterSeconds: 60 });
  });

  it('treats empty text as a failure, not a blank transcript', async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ text: '  ' }), { status: 200 })) as unknown as typeof fetch;
    expect(await transcribeWithWhisper({ apiKey: 'k', fetchImpl }, input)).toEqual({ ok: false, reason: 'no speech recognised' });
  });
});

import { whisperConfigFromEnv } from '../core/transcribe';

describe('Groq', () => {
  it('reads GROQ_API_KEY and points at Groq with whisper-large-v3', () => {
    expect(whisperConfigFromEnv({ TRANSCRIBER: 'groq', GROQ_API_KEY: 'g' })).toMatchObject({
      provider: 'groq', apiKey: 'g', model: 'whisper-large-v3', baseUrl: 'https://api.groq.com/openai/v1',
    });
  });

  it('turns a rate limit into a wait time instead of a plain failure', async () => {
    const fetchImpl = (async () => new Response(
      '{"error":{"message":"Rate limit reached. Please try again in 7m26.5s."}}', { status: 429 },
    )) as unknown as typeof fetch;
    const r = await transcribeWithWhisper({ provider: 'groq', apiKey: 'g', fetchImpl }, { audio: Buffer.from('x'), contentType: 'audio/mpeg', durationSeconds: 5 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.retryAfterSeconds).toBe(447);
  });
});

describe('Whisper request shape', () => {
  it('sends no prompt — a prompt leaked into real transcripts', async () => {
    let sent: FormData | null = null;
    const fetchImpl = (async (_u: string, init: RequestInit) => { sent = init.body as FormData; return new Response('{"text":"hi"}', { status: 200 }); }) as unknown as typeof fetch;
    await transcribeWithWhisper({ apiKey: 'k', fetchImpl }, { audio: Buffer.from('x'), contentType: 'audio/mpeg', durationSeconds: 1 });
    expect(sent!.get('prompt')).toBeNull();
  });
});

describe('English for every call', () => {
  it('defaults to Whisper translate (English), with an opt-out', () => {
    expect(whisperConfigFromEnv({ TRANSCRIBER: 'groq' }).task).toBe('translate');
    expect(whisperConfigFromEnv({ TRANSCRIBER: 'groq', TRANSCRIBE_TASK: 'transcribe' }).task).toBe('transcribe');
  });
  it('calls the translations endpoint in translate mode', async () => {
    let url = '';
    const fetchImpl = (async (u: string) => { url = u; return new Response('{"text":"My daughter is unwell."}', { status: 200 }); }) as unknown as typeof fetch;
    await transcribeWithWhisper({ apiKey: 'k', task: 'translate', baseUrl: 'https://api.groq.com/openai/v1', fetchImpl }, { audio: Buffer.from('x'), contentType: 'audio/mpeg', durationSeconds: 1 });
    expect(url).toBe('https://api.groq.com/openai/v1/audio/translations');
  });
});
