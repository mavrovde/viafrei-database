/**
 * `reclaim [--dry-run]`: returns the space the GTFS prune freed in stop_times
 * and trips to the disk, `VACUUM (FULL, ANALYZE)` of each, the rewrite the
 * infrastructure's GTFS reclaim job ran through psql until this command.
 *
 * The rewrite holds ACCESS EXCLUSIVE on each table for its whole length:
 * every departure read waits behind it. So it refuses, rewriting nothing,
 * unless every precondition the database can answer holds:
 *   - the prune is done: no stale trip in trips (loaded_run_id other than the
 *     feed's), no retired trip queued in gtfs_stale_trips;
 *   - no delfi_static / gtfs_roll run open in ingest_runs (the last day);
 *   - nobody holds the GTFS write lock (this session takes it);
 *   - it is not 22:00-23:30 UTC, the GTFS load window.
 * The free disk the rewrite needs at its peak is a fact of the host's file
 * system, which SQL cannot read: the caller judges it before it starts this.
 *
 * The precondition read takes the GTFS write lock for its session, so neither
 * a load nor the catch-up prune starts underneath (a dry run too, until it
 * returns); lock_timeout 5s makes the rewrite
 * give up rather than queue behind a long reader (and so stall every reader
 * behind itself); statement_timeout 0, because the rewrite of stop_times is
 * minutes. Exit 0 done (or, with --dry-run, every precondition holds), 1 the
 * rewrite failed, 2 refused.
 */
import type pg from "pg";

/** The main repository's connectors/gtfs/load.ts GTFS_WRITE_LOCK, 0x67_74_66_73 ('gtfs'). */
export const GTFS_WRITE_LOCK = 1735681651;
/** The one GTFS feed key the timetable is loaded under. */
export const GTFS_FEED_KEY = 1;

export const PRECONDITIONS_SQL = `select
  (select count(*) from public.trips t where t.gtfs_feed_key = ${String(GTFS_FEED_KEY)}
      and t.loaded_run_id is distinct from (select (f.extras->>'loaded_run_id')::bigint from public.feeds f where f.gtfs_feed_key = ${String(GTFS_FEED_KEY)}))::int as stale,
  (select count(*) from public.gtfs_stale_trips)::int as queued,
  (select count(*) from public.ingest_runs where provider in ('delfi_static', 'gtfs_roll') and finished_at is null and started_at > now() - interval '1 day')::int as open_runs,
  pg_try_advisory_lock(${String(GTFS_WRITE_LOCK)}) as locked`;

export type Preconditions = { readonly stale: number; readonly queued: number; readonly open_runs: number; readonly locked: boolean };

/** Every precondition that does not hold, worded for the operator; empty when all do. */
export function refusals(p: Preconditions, now: Date): string[] {
  const why: string[] = [];
  if (p.stale > 0) why.push(`the prune is not done: ${String(p.stale)} stale trip(s) are still in trips`);
  if (p.queued > 0) why.push(`the prune is not done: ${String(p.queued)} retired trip(s) still have stop times to delete`);
  if (p.open_runs > 0) why.push(`${String(p.open_runs)} delfi_static/gtfs_roll run(s) are open: a load is running`);
  if (!p.locked) why.push("the GTFS write lock is held (a load or the catch-up prune)");
  const hm = now.getUTCHours() * 60 + now.getUTCMinutes();
  if (hm >= 22 * 60 && hm <= 23 * 60 + 30) why.push(`it is ${now.toISOString().slice(11, 16)} UTC, inside the GTFS load window (22:00-23:30 UTC)`);
  return why;
}

export const REWRITE = ["vacuum (full, analyze) public.stop_times", "vacuum (full, analyze) public.trips"] as const;

export async function reclaim(pool: pg.Pool, opts: { readonly dryRun: boolean; readonly now?: Date }): Promise<{ ok: boolean; lines: string[]; exitCode: number }> {
  const c = await pool.connect();
  const lines: string[] = [];
  try {
    const p = (await c.query<Preconditions>(PRECONDITIONS_SQL)).rows[0] as Preconditions;
    // The write lock is taken by the read itself and held by this session to the end.
    const why = refusals(p, opts.now ?? new Date());
    if (why.length > 0) return { ok: false, exitCode: 2, lines: ["✗ reclaim REFUSED — nothing was rewritten:", ...why.map((w) => `    - ${w}`)] };
    if (opts.dryRun) return { ok: true, exitCode: 0, lines: ["✓ reclaim: every precondition the database answers holds (dry run: nothing rewritten)"] };
    await c.query("set lock_timeout = '5s'");
    await c.query("set statement_timeout = 0");
    for (const sql of REWRITE) {
      const t0 = Date.now();
      await c.query(sql);
      lines.push(`✓ ${sql} (${String(Date.now() - t0)} ms)`);
    }
    return { ok: true, exitCode: 0, lines };
  } catch (e) {
    return { ok: false, exitCode: 1, lines: [...lines, `✗ reclaim failed: ${(e as Error).message.slice(0, 300)}`] };
  } finally {
    // The session's lock and settings die with the connection.
    c.release(true);
  }
}
