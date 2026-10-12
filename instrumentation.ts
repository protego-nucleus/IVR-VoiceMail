// instrumentation.ts — Next's once-per-server-start hook, used to start the five-minute
// mailbox timer (2026-08-24). Guarded to the node runtime: register() is also evaluated for
// the edge bundle (middleware), where timers and Prisma do not exist.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startMailboxTimer } = await import('./lib/ingest/schedule');
    const r = startMailboxTimer();
    if (!r.started) console.log(`[mailbox tick] not started — ${r.reason}`);

    // Background, never awaited: a slow vendor must not delay the server becoming ready.
    void import('./lib/backfill-recordings')
      .then(m => m.backfillRecordings())
      .then(s => console.log(`[recording backfill] scanned ${s.scanned}, attached ${s.fixed}, still failing ${s.failed}`))
      .catch(e => console.warn(`[recording backfill] aborted: ${e instanceof Error ? e.message : String(e)}`))
      // After the recordings, so audio attached just now is transcribed in the same start.
      .then(() => import('./lib/backfill-transcripts'))
      .then(m => m.backfillTranscripts())
      .then(s => console.log(`[transcript backfill] lengths repaired ${s.repaired}, transcribed ${s.done}, failed ${s.failed}${s.skipped ? `, skipped: ${s.skipped}` : ''}`))
      .catch(e => console.warn(`[transcript backfill] aborted: ${e instanceof Error ? e.message : String(e)}`));
  }
}
