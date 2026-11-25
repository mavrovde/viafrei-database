/**
 * 0345: api_reader reads the eight objects behind MCP answers viafrei-api
 * reproduces, each by name.
 *
 *  - SELECT on the seven public relations and EXECUTE on
 *    weather_warning_english(bigint), each present; nothing more on them;
 *  - api_reader reads every one as itself, and runs the function;
 *  - the domains.* tables of the same names, the tables under the two
 *    owner-rights views (vbn_siri_et_calls, weather_warnings_en), the live
 *    German warnings the function reads as its owner, and the partitions of
 *    the two day-partitioned delay tables stay unreadable to it;
 *  - the file applied again, its ledger row deleted, is a no-op.
 *
 *   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/empty npm run test:db
 *
 * Skipped without TEST_DATABASE_URL unless VF_REQUIRE_DB=1.
 */
import type pg from "pg";
import { describe, expect, it } from "vitest";
import { API_READER_0345 } from "./api-reader-base.js";
import { refusal } from "./domain-db.js";
import { migratedSuite } from "./no-transaction-index.js";

const url = process.env["TEST_DATABASE_URL"];

if (url === undefined && process.env["VF_REQUIRE_DB"] === "1") {
  describe("0345 api_reader parity grants", () => {
    it("has a database to run against", () => {
      expect.fail("VF_REQUIRE_DB=1 but TEST_DATABASE_URL is not set — the 0345 test did not run");
    });
  });
}

const FILE = "0345_api_reader_parity_grants.sql";
const FN = "public.weather_warning_english(bigint)";
const PRIVS = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"];
/** What api_reader must still not read after 0345: the domains twins, the tables under its views, the function's German side. */
const FORBIDDEN: readonly string[] = [
  "domains.road_weather_forecast",
  "domains.road_weather_stations",
  "domains.weather_warnings_en",
  "public.vbn_siri_et_calls",
  "public.weather_warnings_en",
  "public.weather_warnings_live",
];
const EXPECTED = [...API_READER_0345.map((n) => `${n} SELECT`), `${FN} EXECUTE`].sort((a, b) => a.localeCompare(b));

describe.skipIf(url === undefined)("0345 api_reader parity grants", () => {
  const { t, service } = migratedSuite(url ?? "postgresql://x@127.0.0.1/x", "parity0345");

  const as = async <R>(fn: (c: pg.PoolClient) => Promise<R>): Promise<R> =>
    t.planted(async (c) => {
      await c.query("set local role api_reader");
      return fn(c);
    });

  /** api_reader's privileges on each relation and on the function, as one sorted list. */
  const held = async (): Promise<string[]> => {
    const r = await t.pool.query<{ s: string }>(
      `select s from (
         select x.n || ' ' || p as s from unnest($1::text[]) x(n) cross join unnest($3::text[]) p where has_table_privilege('api_reader', x.n, p)
         union all
         select $2::text || ' EXECUTE' where has_function_privilege('api_reader', $2::text, 'EXECUTE')) h`,
      [API_READER_0345, FN, PRIVS],
    );
    return r.rows.map((x) => x.s).sort((a, b) => a.localeCompare(b));
  };

  it("names seven relations and the function, every one present", async () => {
    expect(API_READER_0345).toHaveLength(7);
    const r = await t.pool.query<{ n: string }>("select x.n from unnest($1::text[]) x(n) where to_regclass(x.n) is null", [API_READER_0345]);
    expect(r.rows).toEqual([]);
    expect((await t.pool.query("select to_regprocedure($1) is not null as ok", [FN])).rows).toEqual([{ ok: true }]);
  });

  it("api_reader holds SELECT on each relation and EXECUTE on the function, and nothing more on them", async () => {
    expect(await held()).toEqual(EXPECTED);
  });

  it("api_reader reads every one of them, as itself, and runs the function", async () => {
    const failed: string[] = [];
    for (const n of API_READER_0345) {
      try {
        await as((c) => c.query(`select 1 from ${n} limit 0`));
      } catch (e) {
        failed.push(`${n}: ${(e as Error).message}`);
      }
    }
    expect(failed).toEqual([]);
    expect((await as((c) => c.query("select en_headline from public.weather_warning_english(-1)"))).rows).toEqual([]);
  });

  it("api_reader still cannot read the domains twins, the tables under its views, the live German warnings, nor a partition of the delay ticks", async () => {
    const missing = await t.pool.query<{ n: string }>("select x.n from unnest($1::text[]) x(n) where to_regclass(x.n) is null", [FORBIDDEN]);
    expect(missing.rows).toEqual([]);
    for (const n of FORBIDDEN) {
      expect(await refusal(as((c) => c.query(`select 1 from ${n} limit 0`))), n).toMatchObject({ code: "42501" });
    }
    const parts = await t.pool.query<{ p: string }>(
      "select inhrelid::regclass::text as p from pg_inherits where inhparent in ('public.vbb_transit_delays'::regclass, 'public.vrn_transit_delays'::regclass)",
    );
    expect(parts.rows.length).toBeGreaterThan(0);
    for (const { p } of parts.rows) expect(await refusal(as((c) => c.query(`select 1 from ${p} limit 0`))), p).toMatchObject({ code: "42501" });
  });

  it("applied again, its ledger row deleted, applies that file alone and changes nothing", async () => {
    const acl = async (): Promise<{ n: string; a: string | null }[]> =>
      (
        await t.pool.query<{ n: string; a: string | null }>(
          `select x.n, (select relacl::text from pg_class where oid = x.n::regclass) as a from unnest($1::text[]) x(n)
           union all select $2::text, (select proacl::text from pg_proc where oid = $2::text::regprocedure) order by 1`,
          [API_READER_0345, FN],
        )
      ).rows;
    const before = await acl();
    await t.pool.query("delete from schema_migrations where version = 345");
    const run = await service().migrate("cli");
    expect(run.ok, run.lines.join("\n")).toBe(true);
    expect(run.lines.filter((l) => l.startsWith("applying")).map((l) => l.split(" ")[1])).toEqual([FILE]);
    expect(await acl()).toEqual(before);
    expect(await held()).toEqual(EXPECTED);
  });
});
