// lib/recording-fetch.ts — download a vendor recording and convert it to a browser-playable MP3.
// Shared by the live webhook (app/api/voicemail/route.ts) and the one-shot backfill
// (lib/backfill-recordings.ts), so both describe the outcome in the same words.

import 'server-only';
import { toStandardMp3 } from './audio-convert';

export type RecordingResult =
  | { ok: true; audio: Buffer<ArrayBuffer>; contentType: string; note: string }
  | { ok: false; note: string };

function contentTypeFromUrl(url: string): string {
  const ext = url.split('.').pop()?.toLowerCase().split(/[?#]/)[0];
  if (ext === 'mp3') return 'audio/mpeg';
  if (ext === 'wav') return 'audio/wav';
  if (ext === 'ogg') return 'audio/ogg';
  return 'application/octet-stream';
}

export async function fetchRecording(url: string, timeoutMs = 30_000): Promise<RecordingResult> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    const type = res.headers.get('content-type') || contentTypeFromUrl(url);
    if (!res.ok) return { ok: false, note: `Recording link ${url} could not be downloaded (HTTP ${res.status}).` };
    // A login or error page answered with 200 — storing it as "audio" would give a silent player.
    if (/text\/html/i.test(type)) {
      return { ok: false, note: `Recording link ${url} returned a web page, not audio — open it directly.` };
    }
    const raw = Buffer.from(new Uint8Array(await res.arrayBuffer()));
    const kb = Math.round(raw.length / 1024);
    const converted = await toStandardMp3(raw);
    if (converted.ok) {
      return { ok: true, audio: converted.audio, contentType: 'audio/mpeg',
        note: `Recording downloaded from ${url} — ${kb} KB ${type}, converted to standard MP3.` };
    }
    return { ok: true, audio: raw, contentType: type,
      note: `Recording downloaded from ${url} — ${kb} KB ${type}; conversion failed (${converted.reason}), kept as received.` };
  } catch (err) {
    // undici's "fetch failed" hides the real reason (refused, timeout, DNS, TLS) in `cause`.
    const cause = (err as { cause?: { code?: string; message?: string } })?.cause;
    const why = [err instanceof Error ? err.message : String(err), cause?.code, cause?.message].filter(Boolean).join(' — ');
    return { ok: false, note: `Recording link ${url} could not be downloaded (${why}).` };
  }
}
