/**
 * 0348: api_reader reads the row versions of the feed catalogue and of the
 * registered sources (their system columns ctid and xmin), never a column of
 * their own.
 *
 *  - api_reader reads ctid and xmin of every row of both, as itself;
 *  - it reads no column of their own, not the whole row, and nothing else in
 *    the schema ingestor;
 *  - a row written anew has another version: the digest moves;
 *  - the file applied again, its ledger row deleted, is a no-op.
 *
 *   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/empty npm run test:db
 *
 * Skipped without TEST_DATABASE_URL unless VF_REQUIRE_DB=1.
 */
import type pg from "pg";
import { describe, expect, it } from "vitest";
import { refusal } from "./domain-db.js";
import { migratedSuite } from "./no-transaction-index.js";

const url = process.env["TEST_DATABASE_URL"];

if (url === undefined && process.env["VF_REQUIRE_DB"] === "1") {
  describe("0348 api_reader catalogue row versions", () => {
    it("has a database to run against", () => {
      expect.fail("VF_REQUIRE_DB=1 but TEST_DATABASE_URL is not set — the 0348 test did not run");
    });
  });
}

const FILE = "0348_api_reader_catalogue_row_versions.sql";
const DIGEST = "select count(*)::int n, md5(string_agg(t.ctid::text || ':' || t.xmin::text, ',' order by t.ctid)) d from public.feed_catalog t";

describe.skipIf(url === undefined)("0348 api_reader catalogue row versions", () => {
  const { t, service } = migratedSuite(url ?? "postgresql://x@127.0.0.1/x", "catalogue0348");

  const as = async <R>(fn: (c: pg.PoolClient) => Promise<R>): Promise<R> =>
    t.planted(async (c) => {
      await c.query("set local role api_reader");
      return fn(c);
    });

  /** The columns of rel api_reader may read, system columns included. */
  const readable = async (rel = "public.feed_catalog"): Promise<string[]> =>
    (
      await t.pool.query<{ a: string }>(
        `select a.attname a from pg_attribute a where a.attrelid = $1::regclass and not a.attisdropped
            and has_column_privilege('api_reader', a.attrelid, a.attnum, 'SELECT') order by 1`,
        [rel],
      )
    ).rows.map((x) => x.a);

  it("api_reader reads the row versions of every catalogue row, as itself, and they move with a row written anew", async () => {
    await t.pool.query(`insert into public.feed_catalog (feed_key, provider, display_name, licence_id) values ('zz_0348_a', 'test', 'Test A', 'CC0-1.0'), ('zz_0348_b', 'test', 'Test B', 'CC0-1.0')`);
    const all = (await t.pool.query<{ n: number }>("select count(*)::int n from public.feed_catalog")).rows[0]?.n;
    expect(all).toBeGreaterThanOrEqual(2);
    const before = await as((c) => c.query<{ n: number; d: string }>(DIGEST));
    expect(before.rows[0]?.n).toBe(all);
    // A row written anew, even to the same values, is a new row version.
    await t.pool.query("update public.feed_catalog set updated_at = updated_at where feed_key = 'zz_0348_b'");
    const after = await as((c) => c.query<{ n: number; d: string }>(DIGEST));
    expect(after.rows[0]?.d).not.toBe(before.rows[0]?.d);
    await t.pool.query(
      `insert into ingestor.sources (id, name, domain, provider, config_sha256, status, publisher, country, added_in, licence_id, attribution, trust, schedule, registered_by)
       values ('zz_0348', 'zz_0348', 'fuel', 'test', repeat('0', 64), 'enabled', 'Test', 'DE', '0.0.1', 'CC-BY-4.0', 'Test', 50, '{}'::jsonb, 'test')`,
    );
    const sources = await as((c) => c.query<{ n: number }>("select count(*)::int n from ingestor.sources t where t.xmin is not null and t.ctid is not null"));
    expect(sources.rows[0]?.n).toBe((await t.pool.query<{ n: number }>("select count(*)::int n from ingestor.sources")).rows[0]?.n);
  });

  it("api_reader reads no column of the catalogue's own, nor the whole row, nor holds a table privilege on it", async () => {
    expect(await readable()).toEqual(["ctid", "xmin"]);
    const r = await t.pool.query<{ ok: boolean }>("select has_table_privilege('api_reader', 'public.feed_catalog', 'SELECT') ok");
    expect(r.rows[0]?.ok).toBe(false);
    expect(await refusal(as((c) => c.query("select feed_key from public.feed_catalog limit 0")))).toMatchObject({ code: "42501" });
    expect(await refusal(as((c) => c.query("select t from public.feed_catalog t limit 0")))).toMatchObject({ code: "42501" });
    expect(await readable("ingestor.sources")).toEqual(["ctid", "xmin"]);
    expect(await refusal(as((c) => c.query("select id from ingestor.sources limit 0")))).toMatchObject({ code: "42501" });
    const other = await t.pool.query<{ n: string }>(
      `select c.relname n from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'ingestor'
          and c.relkind in ('r', 'p', 'v', 'm') and (has_table_privilege('api_reader', c.oid, 'SELECT') or has_any_column_privilege('api_reader', c.oid, 'SELECT'))`,
    );
    expect(other.rows).toEqual([]);
  });

  it("applied again, its ledger row deleted, applies that file alone and changes nothing", async () => {
    const before = [await readable(), await readable("ingestor.sources")];
    await t.pool.query("delete from schema_migrations where version = 348");
    const run = await service().migrate("cli");
    expect(run.ok, run.lines.join("\n")).toBe(true);
    expect(run.lines.filter((l) => l.startsWith("applying")).map((l) => l.split(" ")[1])).toEqual([FILE]);
    expect([await readable(), await readable("ingestor.sources")]).toEqual(before);
  });
});
