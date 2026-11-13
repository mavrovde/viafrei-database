/**
 * The two actions that are not migrate or partitions: `analyze <table>` and
 * `check`. Both are safe: ANALYZE only refreshes planner statistics, and check
 * only reads.
 */
import type pg from "pg";
import type { MigrationFile } from "./migrations/files.js";
import { compare, readiness, type AppliedRow } from "./migrations/plan.js";
import { readOnly, SQL, type PartitionWindow, type Queryable } from "./diagnostics.js";

/** `name` or `schema.name`, lower-case identifiers only — nothing that needs quoting, nothing that could be SQL. */
export const TABLE_NAME = /^[a-z_][a-z0-9_]{0,62}(\.[a-z_][a-z0-9_]{0,62})?$/;

export const RESOLVE_TABLE = `select quote_ident(n.nspname) || '.' || quote_ident(c.relname) as qualified
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where c.oid = to_regclass($1) and c.relkind in ('r', 'p', 'm')
   and n.nspname not in ('pg_catalog', 'information_schema')`;

export type ActionResult = { readonly ok: boolean; readonly lines: readonly string[] };

/** ANALYZE one table, named by the caller and resolved by the catalogue before anything runs. */
export async function analyzeTable(pool: Pick<pg.Pool, "connect">, table: string, timeoutMs = 600_000): Promise<ActionResult> {
  if (!TABLE_NAME.test(table)) return { ok: false, lines: [`✗ '${table.slice(0, 80)}' is not a table name (lower-case letters, digits and _; optionally schema.name)`] };
  const c = await pool.connect();
  try {
    const r = await c.query<{ qualified: string }>(RESOLVE_TABLE, [table]);
    const qualified = r.rows[0]?.qualified;
    if (qualified === undefined) return { ok: false, lines: [`✗ no table, partitioned table or materialized view named ${table}`] };
    const started = Date.now();
    await c.query(`set statement_timeout = ${String(Math.trunc(timeoutMs))}`);
    // `qualified` was built by quote_ident from the catalogue, never from the input.
    await c.query(`analyze ${qualified}`);
    return { ok: true, lines: [`✓ analyze ${qualified} in ${String(Date.now() - started)} ms`] };
  } catch (e) {
    return { ok: false, lines: [`✗ analyze ${table} failed: ${(e as Error).message.slice(0, 300)}`] };
  } finally {
    await c.query("reset statement_timeout").catch(() => undefined);
    c.release();
  }
}

/** The verdict of `check` over what was read: pure, so every rule is a unit test. */
export function judge(input: { files: readonly MigrationFile[]; rows: readonly AppliedRow[] | null; partitions: readonly PartitionWindow[] | null; hasEnsureFunction: boolean | null }): ActionResult {
  const lines: string[] = [];
  let ok = true;
  const fail = (l: string): void => {
    ok = false;
    lines.push(`✗ ${l}`);
  };
  const state = input.rows === null ? null : compare(input.files, input.rows);
  const r = readiness(state);
  if (r.ready) lines.push(`✓ schema at head ${String(r.head)} (${String(state?.applied ?? 0)} migrations, checksums equal to this image's files)`);
  else fail(`schema: ${r.detail}`);
  if (state !== null && state.ahead.length > 0) lines.push(`⚠ the ledger holds ${String(state.ahead.length)} version(s) this image does not carry (newest ${String(state.ahead[state.ahead.length - 1])}): a newer image migrated this database`);
  if (input.hasEnsureFunction === null) fail("ensure_daily_partitions could not be looked up");
  else if (!input.hasEnsureFunction) fail("ensure_daily_partitions() does not exist");
  if (input.partitions === null) fail("the partition window could not be read");
  else if (input.partitions.length === 0) fail("no tick table (range-partitioned on observed_at) was found — a check over nothing is not a pass");
  else {
    for (const p of input.partitions) {
      const id = `${p.schema}.${p.name}`;
      // The schema keeps NO default partition: a tick outside the covered days
      // is refused loudly rather than parked. Coverage is the guard.
      if (!p.covers_now) fail(`${id} has no partition for now — a tick for now is refused (there is no default partition to take it)`);
      else if (!p.covers_tomorrow) fail(`${id} has no partition for tomorrow — run partitions ensure`);
      if (p.has_default) lines.push(`⚠ ${id} has a DEFAULT partition, which the schema does not create: an out-of-window tick lands there instead of failing`);
      if (p.default_rows_estimate > 0) lines.push(`⚠ ${id}: its default partition holds ~${String(p.default_rows_estimate)} row(s) (planner estimate)`);
    }
    if (input.partitions.every((p) => p.covers_now && p.covers_tomorrow)) lines.push(`✓ ${String(input.partitions.length)} tick table(s): today and tomorrow covered`);
  }
  return { ok, lines };
}

export async function check(pool: Queryable, files: readonly MigrationFile[]): Promise<ActionResult> {
  return readOnly(pool, async (c) => {
    const hasLedger = (await c.query<{ t: string | null }>("select to_regclass('schema_migrations')::text as t")).rows[0]?.t != null;
    const rows = hasLedger
      ? (await c.query<{ version: number; checksum: string }>("select version, checksum from schema_migrations order by version")).rows
      : [];
    const partitions = (await c.query<PartitionWindow>(SQL.partitionWindow)).rows;
    const hasEnsureFunction = (await c.query<{ n: number }>("select count(*)::int as n from pg_proc where proname = 'ensure_daily_partitions'")).rows[0]?.n !== 0;
    return judge({ files, rows, partitions, hasEnsureFunction });
  });
}
