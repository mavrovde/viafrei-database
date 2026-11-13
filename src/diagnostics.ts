/**
 * Read-only diagnostics of the database. Every query runs inside
 * `begin transaction read only` with a statement timeout, through the `pg`
 * driver (these are single SELECTs; psql is kept for the migrations alone).
 *
 * Nothing here returns a statement's literal values: a running query's text is
 * shown with every string literal replaced by '?' and is suppressed entirely
 * when it mentions a password (the role step's ALTER ROLE is visible in
 * pg_stat_activity while it runs).
 */
import type pg from "pg";

export const STATEMENT_TIMEOUT_MS = 5000;

export type Queryable = Pick<pg.Pool, "connect">;

/** One read-only transaction; the client is always released and the transaction always ended. */
export async function readOnly<T>(pool: Queryable, body: (c: pg.PoolClient) => Promise<T>, timeoutMs = STATEMENT_TIMEOUT_MS): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("begin transaction read only");
    await c.query(`set local statement_timeout = ${String(Math.trunc(timeoutMs))}`);
    const out = await body(c);
    await c.query("commit");
    return out;
  } catch (e) {
    await c.query("rollback").catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}

export const SQL = {
  versions: `select version() as postgres,
       (select extversion from pg_extension where extname = 'postgis') as postgis,
       current_database() as database, now() as now`,
  size: `select pg_database_size(current_database())::bigint as bytes`,
  largest: `with rels as (
  select c.oid, n.nspname, c.relname, c.relkind
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where c.relkind in ('r', 'm', 'p') and not c.relispartition
     and n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg_toast%')
select nspname as schema, relname as name, relkind as kind,
       case when relkind = 'p'
            then (select coalesce(sum(pg_total_relation_size(t.relid)), 0) from pg_partition_tree(oid) t where t.isleaf)
            else pg_total_relation_size(oid) end::bigint as bytes
  from rels order by bytes desc, schema, name limit $1`,
  partitionWindow: `with parents as (
  select c.oid, n.nspname, c.relname
    from pg_partitioned_table p
    join pg_class c on c.oid = p.partrelid
    join pg_namespace n on n.oid = c.relnamespace
   where p.partstrat = 'r' and p.partnatts = 1
     and (select a.attname from pg_attribute a where a.attrelid = c.oid and a.attnum = p.partattrs[0]) = 'observed_at'),
kids as (
  select p.oid as parent, k.oid, k.reltuples, pg_get_expr(k.relpartbound, k.oid) as bound
    from parents p join pg_inherits i on i.inhparent = p.oid join pg_class k on k.oid = i.inhrelid),
bounds as (
  select parent, reltuples, bound = 'DEFAULT' as is_default,
         substring(bound from 'FROM \\(''([^'']+)''\\)')::timestamptz as lo,
         substring(bound from 'TO \\(''([^'']+)''\\)')::timestamptz as hi
    from kids)
select p.nspname as schema, p.relname as name,
       count(b.*) filter (where not b.is_default)::int as partitions,
       coalesce(bool_or(b.is_default), false) as has_default,
       coalesce(max(b.reltuples) filter (where b.is_default), 0)::bigint as default_rows_estimate,
       min(b.lo) as oldest_from, max(b.hi) as newest_to,
       coalesce(bool_or(b.lo <= now() and now() < b.hi), false) as covers_now,
       coalesce(bool_or(b.lo <= now() + interval '1 day' and now() + interval '1 day' < b.hi), false) as covers_tomorrow
  from parents p left join bounds b on b.parent = p.oid
 group by p.nspname, p.relname order by p.nspname, p.relname`,
  connections: `select coalesce(usename, '(none)') as role, coalesce(state, '(none)') as state, count(*)::int as count
  from pg_stat_activity where datname = current_database()
 group by 1, 2 order by 3 desc, 1, 2`,
  longQueries: `select pid, coalesce(usename, '(none)') as role, state,
       extract(epoch from now() - coalesce(xact_start, query_start))::int as seconds,
       wait_event_type, wait_event,
       case when query ~* 'password' then '[redacted: mentions a password]'
            else left(regexp_replace(query, '''([^'']|'''')*''', '''?''', 'g'), 200) end as query
  from pg_stat_activity
 where datname = current_database() and pid <> pg_backend_pid()
   and state <> 'idle' and coalesce(xact_start, query_start) < now() - make_interval(secs => $1)
 order by seconds desc limit 20`,
  locks: `select a.pid, coalesce(a.usename, '(none)') as role, pg_blocking_pids(a.pid) as blocked_by,
       l.locktype, l.mode, l.relation::regclass::text as relation,
       extract(epoch from now() - a.query_start)::int as seconds
  from pg_locks l join pg_stat_activity a on a.pid = l.pid
 where not l.granted and a.datname = current_database()
 order by seconds desc limit 20`,
  vacuum: `select schemaname as schema, relname as name, n_live_tup::bigint as live, n_dead_tup::bigint as dead,
       case when n_live_tup + n_dead_tup = 0 then 0 else round(100.0 * n_dead_tup / (n_live_tup + n_dead_tup), 1) end::float8 as dead_pct,
       last_autovacuum, last_autoanalyze, autovacuum_count::bigint as autovacuums
  from pg_stat_user_tables where n_dead_tup > 0
 order by n_dead_tup desc limit 15`,
  wraparound: `select n.nspname as schema, c.relname as name, age(c.relfrozenxid)::bigint as xid_age
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where c.relkind in ('r', 'm', 't') and c.relfrozenxid <> '0'::xid
 order by age(c.relfrozenxid) desc limit 5`,
  vacuumRunning: `select count(*)::int as running from pg_stat_progress_vacuum`,
  ledgerTail: `select version, name, applied_at from schema_migrations order by version desc limit 5`,
} as const;

export type PartitionWindow = {
  readonly schema: string;
  readonly name: string;
  readonly partitions: number;
  readonly has_default: boolean;
  readonly default_rows_estimate: number;
  readonly oldest_from: Date | null;
  readonly newest_to: Date | null;
  readonly covers_now: boolean;
  readonly covers_tomorrow: boolean;
};

export type Diagnostics = {
  readonly versions: { postgres: string; postgis: string | null; database: string; now: Date };
  readonly sizeBytes: number;
  readonly largest: readonly { schema: string; name: string; kind: string; bytes: number }[];
  readonly partitions: readonly PartitionWindow[];
  readonly connections: readonly { role: string; state: string; count: number }[];
  readonly longQueries: readonly { pid: number; role: string; state: string; seconds: number; wait_event_type: string | null; wait_event: string | null; query: string }[];
  readonly locks: readonly { pid: number; role: string; blocked_by: number[]; locktype: string; mode: string; relation: string | null; seconds: number | null }[];
  readonly vacuum: readonly { schema: string; name: string; live: number; dead: number; dead_pct: number; last_autovacuum: Date | null; last_autoanalyze: Date | null; autovacuums: number }[];
  readonly wraparound: readonly { schema: string; name: string; xid_age: number }[];
  readonly vacuumRunning: number;
  readonly ledgerTail: readonly { version: number; name: string; applied_at: Date }[];
};

const num = (v: unknown): number => (typeof v === "number" ? v : Number(v));

export async function collect(pool: Queryable, opts: { largest?: number; longQuerySeconds?: number } = {}): Promise<Diagnostics> {
  return readOnly(pool, async (c) => {
    const q = async <R extends pg.QueryResultRow>(sql: string, params: unknown[] = []): Promise<R[]> => (await c.query<R>(sql, params)).rows;
    const versions = (await q<Diagnostics["versions"]>(SQL.versions))[0];
    if (versions === undefined) throw new Error("version() returned no row");
    const size = (await q<{ bytes: string }>(SQL.size))[0];
    const largest = (await q<{ schema: string; name: string; kind: string; bytes: string }>(SQL.largest, [opts.largest ?? 15])).map((r) => ({ ...r, bytes: num(r.bytes) }));
    const partitions = (await q<PartitionWindow & { default_rows_estimate: string }>(SQL.partitionWindow)).map((r) => ({ ...r, default_rows_estimate: num(r.default_rows_estimate) }));
    const connections = await q<Diagnostics["connections"][number]>(SQL.connections);
    const longQueries = await q<Diagnostics["longQueries"][number]>(SQL.longQueries, [opts.longQuerySeconds ?? 30]);
    const locks = await q<Diagnostics["locks"][number]>(SQL.locks);
    const vacuum = (await q<Diagnostics["vacuum"][number] & { live: string; dead: string; autovacuums: string }>(SQL.vacuum)).map((r) => ({
      ...r,
      live: num(r.live),
      dead: num(r.dead),
      autovacuums: num(r.autovacuums),
    }));
    const wraparound = (await q<{ schema: string; name: string; xid_age: string }>(SQL.wraparound)).map((r) => ({ ...r, xid_age: num(r.xid_age) }));
    const running = (await q<{ running: number }>(SQL.vacuumRunning))[0]?.running ?? 0;
    const hasLedger = (await q<{ t: string | null }>("select to_regclass('schema_migrations')::text as t"))[0]?.t != null;
    const ledgerTail = hasLedger ? await q<Diagnostics["ledgerTail"][number]>(SQL.ledgerTail) : [];
    return { versions, sizeBytes: num(size?.bytes ?? 0), largest, partitions, connections, longQueries, locks, vacuum, wraparound, vacuumRunning: running, ledgerTail };
  });
}
