/**
 * `partitions retain [--apply]`: the database's half of the tick retention,
 * driven by partition_retention (0296, 0305) and nothing else. Schema public's
 * daily ticks only, the tables the main repository's partition-archive pass
 * kept until this command (its domains rows are not dropped by anybody yet,
 * and this command does not start doing so).
 *
 * A day partition is `<table>_YYYYMMDD` whose range is exactly that UTC day;
 * anything else under a parent is reported by name and never touched.
 *
 *   archive = false (the no-archive ticks): a day is past its window when it is
 *     older than keep_days whole days before today on the BERLIN calendar
 *     (keep 1 = today and yesterday stay). It is detached CONCURRENTLY (SHARE
 *     UPDATE EXCLUSIVE on the parent: no reader or writer waits), a pending
 *     detach of the parent finalized first, then dropped with its
 *     partition_archives row (one from before the policy) stamped dropped_at.
 *     A day inside the partition maker's three days back is dropped only when
 *     it holds a row: the maker re-creates it empty, and an empty one is left.
 *     A standalone `<no-archive table>_YYYYMMDD` past its window (a detach
 *     whose drop failed) is dropped too, its archive row, if any, stamped.
 *   archive = true: a day is past its window when it is keep_days or more UTC
 *     days old. It is dropped only once the cold store has recorded its dump:
 *     a partition_archives row with dropped_at NULL ("the file exists and the
 *     partition does too"). Then, in one transaction: the day locked against
 *     writers (SHARE), its rows counted and held equal to the row count the
 *     dump recorded, detach, drop, stamp. A count that differs (a row written
 *     after the dump, or a dump of fewer rows) rolls the transaction back and
 *     HOLDS the day by name. The same path finishes a day whose earlier drop
 *     never happened (a crash between the cold store's row and the drop): the
 *     count stands in for the re-hash of the file, which this image cannot read.
 *     The count runs before the detach so the parent's ACCESS EXCLUSIVE lasts
 *     for the detach and the drop alone, never for a count; the SHARE lock on
 *     the day holds until commit, so no row can arrive between count and drop.
 *     No row: it waits for its dump. A row stamped dropped and restored since:
 *     it waits for a fresh dump (the cold store writes the row again with
 *     dropped_at NULL). A row stamped dropped with no restore since: HELD, by
 *     name, until somebody has looked.
 *
 * From viafrei-database 0.3.5 on this command is the ONLY dropper of a tick
 * partition: the cold store (the main repository's partition-archive pass)
 * keeps the dump, its file check and the partition_archives row with
 * dropped_at NULL, and detaches and drops nothing. The dump, its verification
 * and the restore read and write files, so they stay with the cold store;
 * everything they do to the database is a partition_archives row. Without
 * --apply nothing changes and the plan is printed.
 *
 * Exit: 0 done, 1 a step failed (the others still ran), 4 a day is held.
 */
import pg from "pg";

export const PARTITION_RE = /^[a-z][a-z0-9_]*_(\d{4})(\d{2})(\d{2})$/;
/** ensure_daily_partitions' default days back (0043): a day it re-creates empty. */
export const MAKER_DAYS_BACK = 3;
/** How long a concurrent detach waits for its lock, per phase. */
export const DETACH_WAIT_MS = 60_000;
/** How long a DROP (and an archived day's plain detach) waits for its lock. */
export const DROP_LOCK_TIMEOUT = "3s";

export type Retained = {
  readonly parent: string;
  readonly partition: string;
  readonly keepDays: number;
  readonly archive: boolean;
  readonly lo: Date | null;
  readonly hi: Date | null;
  readonly pending: boolean;
  /** partition_archives for the day: none, recorded (dropped_at null), dropped (and restored since or not). */
  readonly ledger: "none" | "recorded" | "dropped" | "restored";
  readonly hasRow: boolean;
};

export type Leftover = { readonly table: string; readonly relation: string; readonly keepDays: number };

export type Step =
  | { readonly kind: "drop-unarchived"; readonly r: Retained; readonly day: string }
  | { readonly kind: "drop-archived"; readonly r: Retained; readonly day: string }
  | { readonly kind: "drop-leftover"; readonly l: Leftover; readonly day: string };

export type RetainPlan = {
  readonly steps: readonly Step[];
  readonly kept: number;
  readonly lines: readonly string[];
  readonly held: number;
};

const DAY_MS = 86_400_000;

export function utcDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

export function addDays(day: string, n: number): string {
  return utcDay(new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS));
}

export function berlinDay(at: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

/** `<table>_YYYYMMDD` → `YYYY-MM-DD`, or null when the name is none or spells no date. */
export function dayOf(name: string): string | null {
  const m = PARTITION_RE.exec(name);
  if (m === null) return null;
  const day = `${m[1] ?? ""}-${m[2] ?? ""}-${m[3] ?? ""}`;
  const t = Date.parse(`${day}T00:00:00Z`);
  return Number.isFinite(t) && utcDay(new Date(t)) === day ? day : null;
}

/** The newest day a no-archive table may drop: Berlin today less keep + 1. */
export const noArchiveCutoff = (now: Date, keep: number): string => addDays(berlinDay(now), -(keep + 1));
/** The newest day an archived table may drop: UTC today less keep. */
export const archiveCutoff = (now: Date, keep: number): string => addDays(utcDay(now), -keep);

/** The plan: pure, so every rule is a unit test. */
export function planRetain(parts: readonly Retained[], leftovers: readonly Leftover[], now: Date): RetainPlan {
  const steps: Step[] = [];
  const lines: string[] = [];
  let kept = 0;
  let held = 0;
  const band = addDays(utcDay(now), -MAKER_DAYS_BACK);
  for (const r of parts) {
    const day = dayOf(r.partition);
    if (day === null || r.lo === null || r.hi === null || r.lo.getTime() !== Date.parse(`${day}T00:00:00Z`) || r.hi.getTime() - r.lo.getTime() !== DAY_MS) {
      lines.push(`– ${r.partition}: not a <table>_YYYYMMDD partition of exactly that UTC day; not touched`);
      continue;
    }
    if (!r.archive) {
      if (day > noArchiveCutoff(now, r.keepDays) || (day >= band && !r.hasRow)) kept++;
      else steps.push({ kind: "drop-unarchived", r, day });
      continue;
    }
    if (day > archiveCutoff(now, r.keepDays)) kept++;
    else if (r.ledger === "recorded") steps.push({ kind: "drop-archived", r, day });
    else if (r.ledger === "dropped") {
      held++;
      lines.push(`⚠ ${r.partition}: HELD — partition_archives says it was dropped and no restore since explains why it exists; not dropped until somebody has looked`);
    } else lines.push(`– ${r.partition}: past its ${String(r.keepDays)} days, waiting for the cold store to record its ${r.ledger === "none" ? "dump" : "fresh dump (restored since its drop)"}`);
  }
  for (const l of leftovers) {
    const day = dayOf(l.relation);
    if (day !== null && day <= noArchiveCutoff(now, l.keepDays)) steps.push({ kind: "drop-leftover", l, day });
  }
  return { steps, kept, lines, held };
}

/** pg_get_expr renders bounds in the session's TimeZone; the cast reads them back as instants. */
export const SCAN_SQL = `select c.relname as parent, p.relname as partition, r.keep_days as "keepDays", r.archive,
       (regexp_match(pg_get_expr(p.relpartbound, p.oid), $1::text))[1]::timestamptz as lo,
       (regexp_match(pg_get_expr(p.relpartbound, p.oid), $1::text))[2]::timestamptz as hi,
       h.inhdetachpending as pending,
       case when a.id is null then 'none' when a.dropped_at is null then 'recorded'
            when a.restored_at >= a.dropped_at then 'restored' else 'dropped' end as ledger,
       exists (select 1 from pg_class x where x.oid = p.oid and x.reltuples > 0) as "hasRow"
  from public.partition_retention r
  join pg_class c on c.relname = r.table_name and c.relnamespace = 'public'::regnamespace and c.relkind = 'p'
  join pg_inherits h on h.inhparent = c.oid
  join pg_class p on p.oid = h.inhrelid
  left join public.partition_archives a
         on a.table_name = c.relname
        and a.day = case when p.relname ~ '_[0-9]{8}$' then to_date(right(p.relname, 8), 'YYYYMMDD') end
 where r.schema_name = 'public'
 order by c.relname, p.relname`;

export const BOUNDS_RE = String.raw`FOR VALUES FROM \('([^']+)'\) TO \('([^']+)'\)`;

export const LEFTOVER_SQL = `select r.table_name as table, c.relname as relation, r.keep_days as "keepDays"
  from pg_class c
  join public.partition_retention r on r.schema_name = 'public' and not r.archive
       and c.relname = r.table_name || '_' || right(c.relname, 8)
 where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and not c.relispartition
   and c.relname ~ '_[0-9]{8}$'
   and not exists (select 1 from pg_inherits h where h.inhrelid = c.oid or h.inhparent = c.oid)
 order by c.relname`;

/** A catalogue name, quoted: names reach SQL only from pg_class, and are quoted all the same. */
const ident = (name: string): string => `public.${pg.escapeIdentifier(name)}`;

export async function scan(c: pg.ClientBase): Promise<{ parts: Retained[]; leftovers: Leftover[] }> {
  // The real row test for a day with no statistics: reltuples is -1 or 0 until analysed.
  const parts = (await c.query<Retained>(SCAN_SQL, [BOUNDS_RE])).rows;
  const out: Retained[] = [];
  for (const p of parts) out.push(p.hasRow || p.archive ? p : { ...p, hasRow: (await c.query(`select 1 from ${ident(p.partition)} limit 1`)).rows.length > 0 });
  return { parts: out, leftovers: (await c.query<Leftover>(LEFTOVER_SQL)).rows };
}

const STAMP = `update public.partition_archives set dropped_at = now()
  where table_name = $1 and day = $2::date and (dropped_at is null or restored_at >= dropped_at)`;

/** An archived day whose rows are not the rows its recorded dump holds: not dropped, held by name. */
export class RetainHeld extends Error {}

/** The archived day's own rows against the row count its recorded dump holds; the caller holds the day against writers. */
export const DUMP_ROWS_SQL = `select rows::bigint::text as rows from public.partition_archives
  where table_name = $1 and day = $2::date and dropped_at is null for update`;

async function dropStamped(pool: pg.Pool, relation: string, table: string, day: string, archived: boolean): Promise<void> {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query(`set local lock_timeout = '${DROP_LOCK_TIMEOUT}'`);
    if (archived) {
      await c.query(`lock table ${ident(relation)} in share mode`);
      const n = (await c.query<{ n: string }>(`select count(*)::text as n from ${ident(relation)}`)).rows[0]?.n ?? "0";
      const rec = (await c.query<{ rows: string }>(DUMP_ROWS_SQL, [table, day])).rows[0]?.rows;
      if (rec !== n) {
        throw new RetainHeld(
          rec === undefined
            ? `HELD — partition_archives no longer records a dump of it (changed since the scan); not dropped until somebody has looked`
            : `HELD — it holds ${n} row(s), its recorded dump ${rec}; not dropped until somebody has looked`,
        );
      }
      await c.query(`alter table ${ident(table)} detach partition ${ident(relation)}`);
    }
    await c.query(`drop table ${ident(relation)}`);
    await c.query(STAMP, [table, day]);
    await c.query("commit");
  } catch (e) {
    await c.query("rollback").catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}

/** The concurrent detach, outside a transaction, on a connection destroyed afterwards so its timeouts die with it. */
async function detachConcurrently(pool: pg.Pool, table: string, partition: string, waitMs: number): Promise<void> {
  const c = await pool.connect();
  try {
    await c.query(`set lock_timeout = ${String(waitMs)}`);
    await c.query(`set statement_timeout = ${String(2 * waitMs + 10_000)}`);
    const p = await c.query<{ rel: string; pending: boolean }>(
      `select k.relname as rel, h.inhdetachpending as pending from pg_inherits h join pg_class k on k.oid = h.inhrelid
        where h.inhparent = $1::regclass and (h.inhdetachpending or h.inhrelid = $2::regclass)`,
      [ident(table), ident(partition)],
    );
    for (const s of p.rows.filter((x) => x.pending && x.rel !== partition)) await c.query(`alter table ${ident(table)} detach partition ${ident(s.rel)} finalize`);
    const own = p.rows.find((x) => x.rel === partition);
    if (own !== undefined) await c.query(`alter table ${ident(table)} detach partition ${ident(partition)} ${own.pending ? "finalize" : "concurrently"}`);
  } finally {
    c.release(true);
  }
}

export type RetainResult = { readonly ok: boolean; readonly lines: readonly string[]; readonly exitCode: number };

export async function retain(pool: pg.Pool, opts: { readonly apply: boolean; readonly now?: Date; readonly detachWaitMs?: number }): Promise<RetainResult> {
  const now = opts.now ?? new Date();
  const c = await pool.connect();
  let found: { parts: Retained[]; leftovers: Leftover[] };
  try {
    await c.query("set timezone = 'UTC'");
    found = await scan(c);
  } finally {
    c.release(true);
  }
  if (found.parts.length === 0) return { ok: false, exitCode: 1, lines: ["✗ partition_retention reaches no day partition of schema public — a retain over nothing is not a pass"] };
  const plan = planRetain(found.parts, found.leftovers, now);
  const lines = [...plan.lines];
  let failed = 0;
  let held = plan.held;
  for (const s of plan.steps) {
    const name = s.kind === "drop-leftover" ? s.l.relation : s.r.partition;
    const what = s.kind === "drop-unarchived" ? "no archive" : s.kind === "drop-archived" ? "dump recorded" : "detached leftover";
    if (!opts.apply) {
      lines.push(`· would drop ${name} (${what})`);
      continue;
    }
    try {
      if (s.kind === "drop-unarchived") {
        await detachConcurrently(pool, s.r.parent, s.r.partition, opts.detachWaitMs ?? DETACH_WAIT_MS);
        await dropStamped(pool, s.r.partition, s.r.parent, s.day, false);
      } else if (s.kind === "drop-archived") await dropStamped(pool, s.r.partition, s.r.parent, s.day, true);
      else await dropStamped(pool, s.l.relation, s.l.table, s.day, false);
      lines.push(`✓ dropped ${name} (${what})`);
    } catch (e) {
      if (e instanceof RetainHeld) {
        held++;
        lines.push(`⚠ ${name}: ${e.message}`);
        continue;
      }
      failed++;
      lines.push(`✗ ${name}: ${(e as Error).message.slice(0, 300)}`);
    }
  }
  const verb = opts.apply ? "dropped" : "to drop";
  lines.push(`${failed > 0 ? "✗" : "✓"} partitions retain: ${String(plan.steps.length - failed - (held - plan.held))} ${verb}, ${String(failed)} failed, ${String(plan.kept)} kept, ${String(held)} held${opts.apply ? "" : " (dry run: nothing changed; --apply to act)"}`);
  const exitCode = failed > 0 ? 1 : held > 0 ? 4 : 0;
  return { ok: exitCode === 0, lines, exitCode };
}
