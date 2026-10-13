// lib/backfill-transcripts.ts — speech-to-text for every stored recording that has none yet, plus
// a one-line repair of recording lengths the recording backfill saved as 0.
//
// Runs once per server start (instrumentation.ts), in the background. Idempotent: it only picks
// recordings whose transcribedAt is null, so a finished one is never sent twice (and never paid
// for twice). A failure records its reason on the row and is retried on the next start.
//
// Audio is loaded ONE row at a time — 200 recordings at once would hold ~200 MB in memory.

import 'server-only';
import { randomUUID } from 'node:crypto';
import { db } from './db';
import { getClassifier } from '@/core/classify';
import { transcribeWithWhisper, whisperConfigFromEnv } from '@/core/transcribe';

/** Recordings converted by lib/audio-convert.ts are constant 32 kbps = 4000 bytes per second. */
const CONVERTED_BYTES_PER_SECOND = 4000;

async function repairZeroDurations(): Promise<number> {
  const rows = await db.voicemailAudio.findMany({
    where: { durationSeconds: 0, contentType: 'audio/mpeg' },
    select: { id: true, sizeBytes: true },
  });
  for (const r of rows) {
    await db.voicemailAudio.update({
      where: { id: r.id },
      data: { durationSeconds: Math.max(1, Math.round(r.sizeBytes / CONVERTED_BYTES_PER_SECOND)) },
    });
  }
  return rows.length;
}

export async function backfillTranscripts(): Promise<{ repaired: number; done: number; failed: number; skipped?: string }> {
  const repaired = await repairZeroDurations();

  const provider = process.env.TRANSCRIBER ?? 'none';
  if (provider !== 'openai' && provider !== 'groq') return { repaired, done: 0, failed: 0, skipped: `TRANSCRIBER is "${provider}"` };
  const cfg = whisperConfigFromEnv(process.env, provider);
  if (!cfg.apiKey) return { repaired, done: 0, failed: 0, skipped: `${provider === 'groq' ? 'GROQ' : 'OPENAI'}_API_KEY is not set` };
  const label = provider === 'groq' ? 'Groq Whisper' : 'OpenAI Whisper';

  const pending = await db.voicemailAudio.findMany({
    // Voicemails only — an Answered call's recording is never sent for transcription.
    where: { transcribedAt: null, callStatus: { in: ['Unanswered', 'Un-opted'] } },
    select: { id: true },
    orderBy: { receivedAt: 'desc' },
  });

  const classifier = getClassifier('rules');
  let done = 0;
  let failed = 0;
  let next = 0;

  async function worker() {
    while (next < pending.length) {
      const { id } = pending[next++];
      const row = await db.voicemailAudio.findUnique({
        where: { id },
        select: { id: true, requestId: true, audio: true, contentType: true, durationSeconds: true, callerNumber: true },
      });
      if (!row) continue;

      const input = { audio: Buffer.from(row.audio), contentType: row.contentType, durationSeconds: row.durationSeconds };
      let r = await transcribeWithWhisper(cfg, input);
      // Rate-limited (Groq's free tier): wait as long as it says, capped at 15 min, then the SAME
      // recording again — a 429 is "not yet", never a reason to give up on a call.
      for (let tries = 0; !r.ok && r.retryAfterSeconds && tries < 20; tries++) {
        const waitMs = Math.min(r.retryAfterSeconds, 900) * 1000 + 1000;
        await new Promise(res => setTimeout(res, waitMs));
        r = await transcribeWithWhisper(cfg, input);
      }
      if (!r.ok) {
        failed++;
        await db.voicemailAudio.update({ where: { id }, data: { transcriptError: r.reason } });
        continue;
      }

      const sug = classifier.classify({ subject: 'Voicemail', body: r.text, senderIsKnownFamily: false });
      await db.$transaction([
        db.voicemailAudio.update({
          where: { id },
          data: {
            transcript: r.text, transcriptLang: r.language, transcribedAt: new Date(), transcriptError: null,
            ...(r.durationSeconds ? { durationSeconds: r.durationSeconds } : {}),
          },
        }),
        db.request.update({
          where: { id: row.requestId },
          data: {
            subject: `Voicemail from ${row.callerNumber || 'a withheld number'}`,
            body: r.text,
            suggestedCategory: sug.category, suggestedUrgency: sug.urgency, suggestionReason: sug.reason,
          },
        }),
        db.requestMessage.updateMany({ where: { requestId: row.requestId, direction: 'in' }, data: { body: r.text } }),
        db.activity.create({
          data: {
            id: randomUUID(), requestId: row.requestId, at: new Date(), kind: 'note',
            detail: `Transcribed by ${label}${r.language ? ` (detected: ${r.language})` : ''}. Suggested "${sug.category}" — ${sug.reason}`,
          },
        }),
      ]);
      done++;
    }
  }

  // Groq's free tier allows little parallelism; OpenAI's paid tier takes three at once.
  await Promise.all(provider === 'groq' ? [worker()] : [worker(), worker(), worker()]);
  return { repaired, done, failed };
}
