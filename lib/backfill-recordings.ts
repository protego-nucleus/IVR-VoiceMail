// lib/backfill-recordings.ts — attach recordings to call records that arrived while the vendor's
// firewall still blocked our server (30-Sep → 10-Oct-2026: every way2voice.in:444 download timed
// out until they whitelisted our static outbound IPs).
//
// Runs once per server start (instrumentation.ts), in the background, never blocking requests.
// Idempotent by construction: it only looks at call records with NO audio row whose body still
// carries the "could not be downloaded — open it directly: <url>" wording the webhook wrote, so
// a record it fixes is never picked up again. A link that still fails stays as it was and is
// simply retried on the next start.

import 'server-only';
import { randomUUID } from 'node:crypto';
import { db } from './db';
import { fetchRecording } from './recording-fetch';

const MARK = 'could not be downloaded — open it directly: ';

export async function backfillRecordings(): Promise<{ scanned: number; fixed: number; failed: number }> {
  const pending = await db.request.findMany({
    where: { channel: 'call', voicemailAudio: { is: null }, body: { contains: MARK } },
    select: { id: true, ref: true, body: true, subject: true },
    orderBy: { arrivedAt: 'desc' },
  });

  let fixed = 0;
  let failed = 0;
  for (const r of pending) {
    const url = r.body.slice(r.body.indexOf(MARK) + MARK.length).trim().split(/\s/)[0];
    if (!/^https?:\/\//.test(url)) { failed++; continue; }

    const res = await fetchRecording(url);
    if (!res.ok) { failed++; continue; }

    const outcome = r.body.slice(0, r.body.indexOf('The vendor sent a recording link')).trim();
    const body = `${outcome} A recording was captured but could not be transcribed — listen to the recording attached to this record.`;
    await db.$transaction([
      db.voicemailAudio.create({
        data: {
          id: randomUUID(), requestId: r.id, dialledNumber: '',
          callerNumber: (r.subject.match(/from (\d+)/) ?? [, ''])[1],
          ivrMenu: null, contentType: res.contentType, sizeBytes: res.audio.length,
          durationSeconds: 0, audio: res.audio,
        },
      }),
      db.request.update({ where: { id: r.id }, data: { body } }),
      db.requestMessage.updateMany({ where: { requestId: r.id, direction: 'in' }, data: { body } }),
      db.activity.create({
        data: { id: randomUUID(), requestId: r.id, at: new Date(), kind: 'note',
          detail: `${res.note} (Fetched later — the vendor's firewall blocked the download when the call arrived.)` },
      }),
    ]);
    fixed++;
  }
  return { scanned: pending.length, fixed, failed };
}
