import Link from 'next/link';
import { db } from '@/lib/db';
import { currentActor, visibleCampusIds } from '@/lib/session';
import { can } from '@/core/permissions';
import { Card, NewBadge, Quiet, Stat } from '@/components/bits';
import { formatInstantShortIST } from '@/core/dates';

// Call recordings — every IVR call that came with a recording, its audio and its transcript in
// one list (Pradip, 12-Oct-2026: "direct ek dashboard ... text ma transfer kari ne batavo").
//
// The same three read gates as the record page (app/(staff)/r/[ref]/page.tsx) apply to every
// row, because a transcript IS the record's content: campus scope, the QM-D33 about-actor
// exclusion, and safeguarding's named-access gate. A row failing one is left out, not blurred.

export const dynamic = 'force-dynamic';

const PAGE = 300;

/** Voicemail-only (Pradip, 13-Oct-2026): a recording of an ANSWERED call is a conversation, not a
 *  message left, and is never listed here. Rows saved before callStatus existed are all Answered. */
const VOICEMAIL = ['Unanswered', 'Un-opted'];

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/** A YYYY-MM-DD from the date picker, read as an IST calendar day. */
const istDay = (d: string | undefined, end = false) =>
  d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(`${d}T${end ? '23:59:59.999' : '00:00:00'}+05:30`) : undefined;

export default async function CallRecordings({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; from?: string; to?: string; text?: string }>;
}) {
  const sp = await searchParams;
  const q = (sp.q ?? '').trim();
  const from = istDay(sp.from);
  const to = istDay(sp.to, true);

  const actor = await currentActor();
  const campusIds = await visibleCampusIds(actor);

  const rows = await db.voicemailAudio.findMany({
    where: {
      callStatus: { in: VOICEMAIL },
      request: {
        campusOrgUnitId: { in: campusIds },
        NOT: { aboutStaffIds: { has: actor.id } },
        ...(from || to ? { arrivedAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
      },
      ...(sp.text === 'with' ? { transcript: { not: null } } : sp.text === 'without' ? { transcript: null } : {}),
      ...(q
        ? {
            OR: [
              { callerNumber: { contains: q } },
              { transcript: { contains: q, mode: 'insensitive' as const } },
              { request: { ref: { contains: q.toUpperCase() } } },
            ],
          }
        : {}),
    },
    // Never `audio` — the bytes stream from /api/voicemail/[id]/audio only when a player asks.
    select: {
      requestId: true, callerNumber: true, dialledNumber: true, durationSeconds: true,
      transcript: true, transcriptLang: true, transcriptError: true,
      request: { select: { ref: true, arrivedAt: true, campusOrgUnitId: true, isSafeguarding: true } },
    },
    orderBy: { request: { arrivedAt: 'desc' } },
    take: PAGE,
  });

  const visible = rows.filter(r =>
    !r.request.isSafeguarding
    || can(actor, 'view_safeguarding', { campusOrgUnitId: r.request.campusOrgUnitId, isSafeguarding: true }).allowed,
  );

  const scope = { callStatus: { in: VOICEMAIL }, request: { campusOrgUnitId: { in: campusIds } } };
  const [total, withText, failed] = await Promise.all([
    db.voicemailAudio.count({ where: scope }),
    db.voicemailAudio.count({ where: { ...scope, transcript: { not: null } } }),
    db.voicemailAudio.count({ where: { ...scope, transcript: null, transcriptError: { not: null } } }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Quiet>IVR · way2voice</Quiet>
        <h1 className="font-heading text-2xl font-bold tracking-tight mt-1">
          Voicemails <NewBadge />
        </h1>
        <p className="mt-2 text-sm text-muted max-w-[75ch]">
          Messages callers left when nobody answered — listen to one, or read it. The text
          is an automatic English translation of the whole call, whatever language was spoken, so
          it gives the meaning rather than the exact words and can contain mistakes — the
          recording is always the source of truth.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat value={total} label="Voicemails" />
        <Stat value={withText} label="Converted to text" tone="green" />
        <Stat value={total - withText} label="Waiting for text" tone="amber" />
        <Stat value={failed} label="Could not convert" tone={failed ? 'deepred' : 'blue'} />
      </div>

      <form className="flex flex-wrap items-end gap-3" method="get">
        <label className="fh-field">
          <span className="fh-label">Search</span>
          <input className="fh-input" name="q" defaultValue={q} placeholder="Caller number, FD ref or words said" />
        </label>
        <label className="fh-field">
          <span className="fh-label">From</span>
          <input className="fh-input" type="date" name="from" defaultValue={sp.from ?? ''} />
        </label>
        <label className="fh-field">
          <span className="fh-label">To</span>
          <input className="fh-input" type="date" name="to" defaultValue={sp.to ?? ''} />
        </label>
        <label className="fh-field">
          <span className="fh-label">Text</span>
          <select className="fh-select" name="text" defaultValue={sp.text ?? ''}>
            <option value="">All</option>
            <option value="with">Has text</option>
            <option value="without">No text yet</option>
          </select>
        </label>
        <button className="fh-btn fh-btn--primary" type="submit">Filter</button>
        {(q || sp.from || sp.to || sp.text) && <Link href="/calls" className="text-sm text-primary underline">Clear</Link>}
      </form>

      <Quiet>
        Showing {visible.length}{rows.length === PAGE ? ` (newest ${PAGE} — narrow the dates to see older)` : ''}
      </Quiet>

      <div className="flex flex-col gap-3">
        {visible.map(r => (
          <Card key={r.requestId}>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <Link href={`/r/${r.request.ref}`} className="font-semibold text-primary underline">{r.request.ref}</Link>
              <span className="font-semibold tabular-nums">{r.callerNumber || 'Withheld'}</span>
              <span className="text-muted">{formatInstantShortIST(r.request.arrivedAt)}</span>
              {r.dialledNumber && <span className="text-muted">Agent {r.dialledNumber}</span>}
              <span className="text-muted tabular-nums">{mmss(r.durationSeconds)}</span>
              {r.transcriptLang && <span className="fh-badge">{r.transcriptLang}</span>}
            </div>
            {/* eslint-disable-next-line jsx-a11y/media-has-caption -- the transcript below is the caption */}
            <audio controls preload="none" className="w-full mt-3" src={`/api/voicemail/${r.requestId}/audio`} />
            <div className="mt-3 text-sm whitespace-pre-wrap">
              {r.transcript
                ? r.transcript
                : <span className="italic text-subtle">
                    {r.transcriptError ? `Could not convert to text — ${r.transcriptError}` : 'Text not ready yet — listen to the recording.'}
                  </span>}
            </div>
          </Card>
        ))}
        {visible.length === 0 && (
          <p className="text-sm text-muted">
            {total === 0
              ? 'No voicemails yet. The IVR has so far sent recordings only for answered calls — voicemail on unanswered calls has to be switched on at the vendor.'
              : 'No voicemails match.'}
          </p>
        )}
      </div>
    </div>
  );
}
