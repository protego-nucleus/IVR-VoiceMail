// instrumentation.ts — Next's once-per-server-start hook, used to start the five-minute
// mailbox timer (2026-08-24). Guarded to the node runtime: register() is also evaluated for
// the edge bundle (middleware), where timers and Prisma do not exist.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startMailboxTimer } = await import('./lib/ingest/schedule');
    const r = startMailboxTimer();
    if (!r.started) console.log(`[mailbox tick] not started — ${r.reason}`);

    // Background, never awaited: a slow vendor must not delay the server becoming ready. Re-run
    // every 30 minutes so a recording or transcript that failed (rate limit, vendor hiccup) is
    // picked up without waiting for the next deploy. `running` stops two passes overlapping —
    // a Groq rate-limit wait can make one pass outlast the interval.
    let running = false;
    const pass = async () => {
      if (running) return;
      running = true;
      try {
        const rec = await (await import('./lib/backfill-recordings')).backfillRecordings();
        if (rec.scanned) console.log(`[recording backfill] scanned ${rec.scanned}, attached ${rec.fixed}, still failing ${rec.failed}`);
        // After the recordings, so audio attached just now is transcribed in the same pass.
        const t = await (await import('./lib/backfill-transcripts')).backfillTranscripts();
        console.log(`[transcript backfill] lengths repaired ${t.repaired}, transcribed ${t.done}, failed ${t.failed}${t.skipped ? `, skipped: ${t.skipped}` : ''}`);
      } catch (e) {
        console.warn(`[backfill] aborted: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        running = false;
      }
    };
    void pass();
    setInterval(() => void pass(), 30 * 60 * 1000).unref();
  }
}
