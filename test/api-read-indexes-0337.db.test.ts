/**
 * 0337: the indexes the API's reads over the platform's tables need, and
 * api_reader's read of control.data_status.
 *
 *  - each of the three indexes exists, VALID, with the definition the
 *    statement needs, and the API's statement (its predicates as the API
 *    sends them) is answered through it, under the custom and the generic plan;
 *  - api_reader may read control.data_status;
 *  - the file run again (production built an index by hand first) is a
 *    no-op that applies outside a transaction; an INVALID index of one of its
 *    names is dropped and built again; lock_timeout bounds the grants.
 *
 *   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/empty npm run test:db
 *
 * Skipped without TEST_DATABASE_URL unless VF_REQUIRE_DB=1.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { migratedSuite, reapply } from "./no-transaction-index.js";

const url = process.env["TEST_DATABASE_URL"];

if (url === undefined && process.env["VF_REQUIRE_DB"] === "1") {
  describe("0337 API read indexes", () => {
    it("has a database to run against", () => {
      expect.fail("VF_REQUIRE_DB=1 but TEST_DATABASE_URL is not set — the 0337 test did not run");
    });
  });
}

const FILE = "0337_api_read_indexes.sql";

const DEFS = {
  osm_addresses_open_land_extract:
    "CREATE INDEX osm_addresses_open_land_extract ON public.osm_addresses USING btree (land, extract_date DESC NULLS LAST) WHERE (closed_at IS NULL)",
  osm_pois_brand_lower_trgm:
    "CREATE INDEX osm_pois_brand_lower_trgm ON public.osm_pois USING gin (lower(brand) gin_trgm_ops) WHERE (brand IS NOT NULL)",
  weather_warnings_area_desc:
    "CREATE INDEX weather_warnings_area_desc ON public.weather_warnings USING btree (area_desc) WHERE (deleted_at IS NULL)",
} as const;

/** The API's statements (viafrei-api, store), their source-rule part cut to the families given. */
const READS = [
  {
    name: "coverage",
    types: "text[]",
    sql: `select x.extract_date from (select distinct land from osm_addresses where closed_at is null) l
      cross join lateral (select a.extract_date from osm_addresses a
        where a.land = l.land and a.closed_at is null and a.geom is not null and a.source_id = any((select $1::text[])::text[])
        order by a.extract_date desc nulls last limit 1) x`,
    args: "('{osm}')",
    index: /Index Scan using osm_addresses_open_land_extract on osm_addresses a\b/,
  },
  {
    name: "named",
    types: "text[], text",
    sql: `select exists (select from weather_warnings w
      where w.area_desc = (select $2::text) and w.deleted_at is null and w.valid_from is not null
        and w.source_feed = any((select $1::text[])::text[]))`,
    args: "('{dwd_warnings}', 'Gemeinde 17')",
    index: /Index Scan using weather_warnings_area_desc on weather_warnings w/,
  },
  {
    name: "warnings",
    types: "text[], text, timestamptz, int",
    sql: `select w.id from weather_warnings w
      where (w.warncell_id = (select $2::text) or w.area_desc = (select $2::text))
        and w.source_feed = any((select $1::text[])::text[])
        and w.closed_at is null and w.deleted_at is null and w.closed_reason is distinct from 'withdrawn'
        and w.valid_from <= (select $3::timestamptz) and (w.valid_to is null or w.valid_to > (select $3::timestamptz))
        and w.level >= (select $4::int)`,
    args: "('{dwd_warnings}', 'Gemeinde 17', now(), 1)",
    index: /Bitmap Index Scan on weather_warnings_area_desc/,
  },
  {
    name: "poi",
    types: "text, text[], int",
    sql: `select p.id from osm_pois p
      where p.closed_at is null and p.geom is not null
        and (p.name_norm like '%' || $1::text || '%' or lower(p.brand) like '%' || $1::text || '%')
        and p.source_id = any($2::text[])
      order by similarity(p.name_norm, $1::text) desc limit $3::int`,
    args: "('aral17', '{osm}', 51)",
    index: /Bitmap Index Scan on osm_pois_brand_lower_trgm/,
  },
] as const;

const ADDRESSES = `insert into osm_addresses (osm_type, osm_id, street, house_number, street_norm, house_number_norm, geom, extract_date, land, source_id, postcode)
  select 'node', g, 's', '1', 's' || (g % 500), '1', st_setsrid(st_makepoint(6 + (g % 900) / 100.0, 47 + (g % 700) / 100.0), 4326)::geography,
         date '2026-11-01' + (g % 3), 'Land' || (g % 16), 'osm', '10115' from generate_series(1, 60000) g`;
const POIS = `insert into osm_pois (osm_type, osm_id, name, name_norm, category, category_value, geom, extract_date, brand, source_id)
  select 'node', g, 'poi' || g, 'poi' || g, 'amenity', 'cafe', st_setsrid(st_makepoint(6 + (g % 900) / 100.0, 47 + (g % 700) / 100.0), 4326)::geography,
         date '2026-11-01', case when g % 10 = 0 then (array['Aral', 'Shell', 'Edeka', 'Rewe'])[1 + g % 4] || (g % 97) end, 'osm' from generate_series(1, 60000) g`;
const WARNINGS = `insert into weather_warnings (source_feed, source_id, identifier, warncell_id, version, level, official_sha256, valid_from, valid_to, area_sha256, raw, area_desc, event, closed_at, closed_reason)
  select 'dwd_warnings', 'dwd', 'id' || g, 'c' || (g % 5000), 1, 1 + g % 4, repeat('a', 64), now() - interval '1 day', now() + interval '1 day', repeat('b', 64), '{}',
         'Gemeinde ' || (g % 5000), 'Frost', case when g % 3 = 0 then now() end, case when g % 3 = 0 then 'superseded' end from generate_series(1, 60000) g`;

const indexes = async (q: (sql: string) => Promise<{ rows: { name: string; def: string; valid: boolean }[] }>) =>
  (await q(`select c.relname name, replace(pg_get_indexdef(c.oid), 'public.gin_trgm_ops', 'gin_trgm_ops') def, x.indisvalid valid from pg_class c join pg_index x on x.indexrelid = c.oid
     where c.relname in ('osm_addresses_open_land_extract', 'weather_warnings_area_desc', 'osm_pois_brand_lower_trgm') order by 1`)).rows;

const expected = Object.entries(DEFS).map(([name, def]) => ({ name, def, valid: true }));

describe.skipIf(url === undefined)("0337 the API's read indexes and api_reader's data_status", () => {
  const { t, service } = migratedSuite(url ?? "postgresql://x@127.0.0.1/x", "apiidx");

  it("holds the three indexes VALID, with the definitions the statements need", async () => {
    expect(await indexes((s) => t.pool.query(s))).toEqual(expected);
  });

  it("answers the place coverage, a named cell's warnings and the POI brand match through them, custom and generic plan", async () => {
    const c = await t.pool.connect();
    try {
      await c.query("begin");
      await c.query(ADDRESSES);
      await c.query(POIS);
      await c.query(WARNINGS);
      await c.query("analyze osm_addresses; analyze osm_pois; analyze weather_warnings");
      for (const r of READS) {
        await c.query(`prepare t_${r.name}(${r.types}) as ${r.sql}`);
        for (const mode of ["force_custom_plan", "force_generic_plan"]) {
          await c.query(`set local plan_cache_mode = ${mode}`);
          const plan = (await c.query<{ "QUERY PLAN": string }>(`explain (costs off) execute t_${r.name}${r.args}`)).rows.map((x) => x["QUERY PLAN"]).join("\n");
          expect(plan, `${r.name} ${mode}`).toMatch(r.index);
        }
      }
    } finally {
      await c.query("rollback");
      c.release();
    }
  }, 120_000);

  it("lets api_reader read control.data_status", async () => {
    const { rows } = await t.pool.query<{ usage: boolean; sel: boolean }>(
      "select has_schema_privilege('api_reader', 'control', 'USAGE') usage, has_table_privilege('api_reader', 'control.data_status', 'SELECT') sel",
    );
    expect(rows).toEqual([{ usage: true, sel: true }]);
  });

  it("bounds the grants' lock wait: lock_timeout set before the first grant, reset after the last", () => {
    const sql = readFileSync(new URL(`../db/migrations/${FILE}`, import.meta.url), "utf8").replace(/--[^\n]*/g, "");
    const set = sql.indexOf("set lock_timeout = '5s'");
    expect(set).toBeGreaterThan(-1);
    expect(set).toBeLessThan(sql.indexOf("grant usage on schema control to api_reader"));
    expect(sql.indexOf("reset lock_timeout")).toBeGreaterThan(sql.indexOf("grant select on control.data_status to api_reader"));
  });

  it("run again where the indexes and the grants are there (production built them by hand) keeps them, outside a transaction", async () => {
    const oid = "select 'public.osm_pois_brand_lower_trgm'::regclass::oid oid";
    const before = (await t.pool.query<{ oid: number }>(oid)).rows[0]!.oid;
    await reapply(t, service(), FILE);
    expect((await t.pool.query<{ oid: number }>(oid)).rows[0]!.oid).toBe(before);
    expect(await indexes((s) => t.pool.query(s))).toEqual(expected);
  });

  it("drops an INVALID index of one of its names and builds it again", async () => {
    await t.pool.query("drop index public.weather_warnings_area_desc");
    // A unique concurrent build over a duplicated name fails and leaves the INVALID index behind.
    await t.pool.query(`insert into weather_warnings (source_feed, source_id, identifier, warncell_id, version, level, official_sha256, valid_from, area_sha256, raw, area_desc)
      select 'dwd_warnings', 'dwd', 'dup' || g, 'c', 1, 1, repeat('a', 64), now(), repeat('b', 64), '{}', 'dup' from generate_series(1, 2) g`);
    await expect(t.pool.query("create unique index concurrently weather_warnings_area_desc on public.weather_warnings (area_desc) where deleted_at is null")).rejects.toThrow();
    expect((await t.pool.query("select 1 from pg_index where indexrelid = 'public.weather_warnings_area_desc'::regclass and not indisvalid")).rowCount).toBe(1);
    await reapply(t, service(), FILE);
    expect(await indexes((s) => t.pool.query(s))).toEqual(expected);
    await t.pool.query("delete from weather_warnings where identifier like 'dup%'");
  });
});
