/**
 * What every domain-table DB test shares: a database of its own next to
 * TEST_DATABASE_URL's (migrate.db.test.ts needs that one EMPTY), migrated to
 * head through the service, with the test's sources registered; the ingestor
 * role's transaction; and the catalogue reads that compare a domain table with
 * domains.speed_cameras, the convention's model.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { loadConfig } from "../src/config.js";
import { DatabaseService } from "../src/service.js";
import { REPO } from "./helpers.js";

export const SYSTEM = ["id", "source_id", "feed", "external_id", "match_key", "observed_at", "first_seen_at", "updated_at", "closed_at", "geom", "extras"];
export const MERGE_COLUMNS = ["entity_key", "trust", "attribution", "licence_id", "sources", "source_count"];
/** The ingestor's SQL_TYPE vocabulary: the types a domain writer can declare. */
export const WRITER_TYPES = new Set(["text", "integer", "bigint", "double precision", "numeric", "boolean", "timestamp with time zone", "date", "jsonb"]);
/** Every reader role of the baseline: none may read a new domain relation. */
export const READERS = ["viafrei_mcp", "viafrei_digest", "viafrei_status", "viafrei_ops", "viafrei_translate"];

export type Source = readonly [id: string, domain: string, trust: number];
export type Refusal = { code?: string; message: string } | null;

export const refusal = (p: Promise<unknown>): Promise<Refusal> =>
  p.then(
    () => null,
    (e: unknown) => e as { code?: string; message: string },
  );

export type Col = { column_name: string; data_type: string; is_nullable: string; column_default: string | null; is_identity: string };

export class DomainDb {
  readonly name: string;
  private readonly admin: pg.Pool;
  private readonly own: URL;
  private svc: DatabaseService | undefined;
  private p: pg.Pool | undefined;

  constructor(url: string, suffix: string) {
    this.name = `test_vfdb_${suffix}_${String(process.pid)}`;
    this.admin = new pg.Pool({ connectionString: url, max: 1 });
    this.own = new URL(url);
    this.own.pathname = `/${this.name}`;
  }

  get pool(): pg.Pool {
    if (this.p === undefined) throw new Error("the test database was not made");
    return this.p;
  }

  get files(): DatabaseService["files"] {
    if (this.svc === undefined) throw new Error("the test database was not made");
    return this.svc.files;
  }

  async make(sources: readonly Source[]): Promise<void> {
    const log = { info: () => undefined, warn: () => undefined, error: () => undefined };
    await this.admin.query(`drop database if exists ${this.name} with (force)`);
    await this.admin.query(`create database ${this.name}`);
    this.svc = new DatabaseService({ config: loadConfig({ DATABASE_URL: this.own.toString(), DB_MIGRATE_LOCK_PAUSE_S: "1" }, "serve"), log });
    await this.svc.boot(1_000);
    this.p = new pg.Pool({ connectionString: this.own.toString(), max: 2 });
    for (const [id, domain, trust] of sources) {
      await this.p.query(
        `insert into ingestor.sources (id, name, domain, provider, config_sha256, status, publisher, country, added_in, licence_id, attribution, trust, schedule, registered_by)
         values ($1, $1, $2, 'test', repeat('0', 64), 'enabled', 'Test', 'DE', '0.0.1', 'CC-BY-4.0', 'Test', $3, '{}'::jsonb, 'test')`,
        [id, domain, trust],
      );
    }
  }

  async drop(): Promise<void> {
    await this.p?.end();
    await this.svc?.close();
    await this.admin.query(`drop database if exists ${this.name} with (force)`);
    await this.admin.end();
  }

  /** Runs fn as viafrei_ingestor for one source, in a transaction that is rolled back. */
  async asSource<R>(source: string | null, fn: (c: pg.PoolClient) => Promise<R>): Promise<R> {
    const c = await this.pool.connect();
    try {
      await c.query("begin");
      await c.query("set local role viafrei_ingestor");
      if (source !== null) await c.query("select set_config('viafrei.source_id', $1, true)", [source]);
      return await fn(c);
    } finally {
      await c.query("rollback");
      c.release();
    }
  }

  /** Runs fn as the owner in a transaction that is rolled back. */
  async planted<R>(fn: (c: pg.PoolClient) => Promise<R>): Promise<R> {
    const c = await this.pool.connect();
    try {
      await c.query("begin");
      return await fn(c);
    } finally {
      await c.query("rollback");
      c.release();
    }
  }

  async columnsOf(table: string, schema = "domains"): Promise<Col[]> {
    return (
      await this.pool.query<Col>(
        `select column_name, case when data_type = 'USER-DEFINED' then udt_name else data_type end as data_type, is_nullable, column_default, is_identity
           from information_schema.columns where table_schema = $2 and table_name = $1 order by ordinal_position`,
        [table, schema],
      )
    ).rows;
  }

  /** Indexes and constraints of a domain table, its own name replaced by T, sorted. */
  async shape(table: string): Promise<string[]> {
    const idx = await this.pool.query<{ d: string }>("select indexdef as d from pg_indexes where schemaname = 'domains' and tablename = $1", [table]);
    const con = await this.pool.query<{ d: string }>("select contype::text || ' ' || conname || ' ' || pg_get_constraintdef(oid) as d from pg_constraint where conrelid = ('domains.' || $1)::regclass", [table]);
    return [...idx.rows, ...con.rows].map((x) => x.d.replaceAll(table, "T")).sort();
  }

  async rls(table: string): Promise<{ e: boolean; f: boolean } | undefined> {
    return (await this.pool.query<{ e: boolean; f: boolean }>("select relrowsecurity as e, relforcerowsecurity as f from pg_class where oid = ('domains.' || $1)::regclass", [table])).rows[0];
  }

  async policies(table: string): Promise<{ policyname: string; cmd: string; roles: string[]; qual: string | null; with_check: string | null }[]> {
    type Pol = { policyname: string; cmd: string; roles: string[]; qual: string | null; with_check: string | null };
    return (
      await this.pool.query<Pol>("select policyname, cmd, roles::text[] as roles, qual, with_check from pg_policies where schemaname = 'domains' and tablename = $1 order by policyname", [table])
    ).rows.map((x) => ({ ...x, policyname: x.policyname.replace(table, "T"), with_check: x.with_check?.replaceAll(table, "T") ?? null }));
  }

  /** Every grant on the named domain relations, PUBLIC included, as rel → grantee:PRIVS. */
  async grants(rels: readonly string[]): Promise<Map<string, string[]>> {
    const r = await this.pool.query<{ rel: string; grantee: string; privs: string }>(
      `select c.relname as rel, coalesce(g.rolname, 'PUBLIC') as grantee, string_agg(x.privilege_type, ',' order by x.privilege_type) as privs
         from pg_class c cross join lateral aclexplode(c.relacl) x left join pg_roles g on g.oid = x.grantee
        where c.relnamespace = 'domains'::regnamespace and c.relname = any($1::text[])
          and x.grantee <> c.relowner
        group by 1, 2 order by 1, 2`,
      [rels],
    );
    const out = new Map<string, string[]>(rels.map((x) => [x, []]));
    for (const x of r.rows) out.get(x.rel)?.push(`${x.grantee}:${x.privs}`);
    return out;
  }

  /** The (role, relation) pairs among the readers that CAN select, by any grant or through PUBLIC. */
  async readable(rels: readonly string[]): Promise<{ checked: number; open: string[] }> {
    const can = await this.pool.query<{ role: string; rel: string; ok: boolean }>(
      `select r as role, t as rel, has_table_privilege(r, t, 'select') as ok
         from unnest($1::text[]) r cross join unnest($2::text[]) t order by 1, 2`,
      [READERS, rels],
    );
    return { checked: can.rows.length, open: can.rows.filter((x) => x.ok).map((x) => `${x.role} ${x.rel}`) };
  }

  /** Columns and constraints of an old public table, as the baseline's text and as the catalogue holds them. */
  async baselineAgreement(table: string): Promise<{ baseline: { columns: string[]; constraints: string[] }; catalogue: { columns: string[]; constraints: string[] } }> {
    const baseline = readFileSync(join(REPO, "db", "baseline", "0293_baseline.sql"), "utf8");
    const block = new RegExp(`\\nCREATE TABLE public\\.${table} \\(\\n([^]*?)\\n\\)`).exec(baseline)?.[1];
    if (block === undefined) throw new Error(`${table}: no CREATE TABLE block in the baseline`);
    const lines = block.split("\n").map((l) => l.trim().replace(/,$/, ""));
    const columns = lines.filter((l) => !l.startsWith("CONSTRAINT ")).map((l) => l.split(" ")[0] ?? "");
    const inline = lines.filter((l) => l.startsWith("CONSTRAINT ")).map((l) => l.replace(/^CONSTRAINT /, ""));
    const added = [...baseline.matchAll(new RegExp(`\\nALTER TABLE (?:ONLY )?public\\.${table}\\n    ADD CONSTRAINT ([^;]+);`, "g"))].map((m) => m[1] ?? "");
    const cols = await this.pool.query<{ a: string }>(
      "select attname as a from pg_attribute where attrelid = ('public.' || $1)::regclass and attnum > 0 and not attisdropped order by attnum",
      [table],
    );
    // Read with the dump's empty search_path, so a definition is qualified as the baseline writes it.
    const cons = await this.planted(async (c) => {
      await c.query("set local search_path = ''");
      return (
        await c.query<{ d: string }>("select conname || ' ' || pg_catalog.pg_get_constraintdef(oid) as d from pg_catalog.pg_constraint where conrelid = ('public.' || $1)::pg_catalog.regclass", [table])
      ).rows.map((x) => x.d);
    });
    return { baseline: { columns, constraints: [...inline, ...added].sort() }, catalogue: { columns: cols.rows.map((x) => x.a), constraints: cons.sort() } };
  }
}

/**
 * The ingestor's two writes for a domain (core/write-sql.ts): the state upsert
 * (insert or update when something differs) and the tick append (insert, a
 * repeat of the owner key with the same observed_at a no-op). Both take one
 * jsonb parameter per batch through jsonb_to_recordset; geometry comes as WKT.
 */
export function upsertSql(table: string, writable: Readonly<Record<string, string>>): string {
  const cols = Object.keys(writable);
  const recordset = ["external_id text", "match_key text", "observed_at timestamptz", "geom_wkt text", "extras jsonb", ...cols.map((c) => `${c} ${writable[c] ?? ""}`)].join(", ");
  const change = ["match_key", "observed_at", "geom", "extras", ...cols];
  const compared = change.filter((c) => c !== "observed_at");
  return `insert into ${table} as t (source_id, feed, external_id, match_key, observed_at, geom, extras, ${cols.join(", ")})
select $2, $3, r.external_id, r.match_key, coalesce(r.observed_at, clock_timestamp()),
       case when r.geom_wkt is not null then ST_GeomFromText(r.geom_wkt, 4326) end,
       coalesce(r.extras, '{}'::jsonb), ${cols.map((c) => `r.${c}`).join(", ")}
  from jsonb_to_recordset($1::jsonb) as r(${recordset})
on conflict (source_id, feed, external_id) do update
   set ${change.map((c) => `${c} = excluded.${c}`).join(", ")}, closed_at = null, updated_at = clock_timestamp()
 where (${compared.map((c) => `t.${c}`).join(", ")}, t.closed_at) is distinct from (${compared.map((c) => `excluded.${c}`).join(", ")}, null)
returning (xmax = 0) as inserted`;
}

export function appendSql(table: string, writable: Readonly<Record<string, string>>): string {
  const cols = Object.keys(writable);
  const recordset = ["external_id text", "match_key text", "observed_at timestamptz", "geom_wkt text", "extras jsonb", ...cols.map((c) => `${c} ${writable[c] ?? ""}`)].join(", ");
  return `insert into ${table} as t (source_id, feed, external_id, match_key, observed_at, geom, extras, ${cols.join(", ")})
select $2, $3, r.external_id, r.match_key, coalesce(r.observed_at, clock_timestamp()),
       case when r.geom_wkt is not null then ST_GeomFromText(r.geom_wkt, 4326) end,
       coalesce(r.extras, '{}'::jsonb), ${cols.map((c) => `r.${c}`).join(", ")}
  from jsonb_to_recordset($1::jsonb) as r(${recordset})
on conflict (source_id, feed, external_id, observed_at) do nothing
returning true as inserted`;
}
