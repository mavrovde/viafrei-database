/**
 * 0350: the charging feed register, one row per charging feed the charging
 * answers read, seeded from the platform's feed registry.
 *
 *  - 34 site feeds, ranked, two retired at 2026-10-19 00:00 Berlin, one
 *    twin (the register, 50 m);
 *  - 31 status feeds with their age limits, the site feed each speaks for
 *    (20 pairs), the frozen window where one is judged;
 *  - the role checks refuse a site row without a rank, a status row without
 *    its age limits, a status field on a site row;
 *  - api_reader reads it, energy_page_slugs, feed_run_extents and feed_versions, as itself;
 *  - the file applied again is a no-op.
 *
 *   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/empty npm run test:db
 *
 * Skipped without TEST_DATABASE_URL unless VF_REQUIRE_DB=1.
 */
import type pg from "pg";
import { describe, expect, it } from "vitest";
import { migratedSuite } from "./no-transaction-index.js";

const url = process.env["TEST_DATABASE_URL"];

if (url === undefined && process.env["VF_REQUIRE_DB"] === "1") {
  describe("0350 charging feed register", () => {
    it("has a database to run against", () => {
      expect.fail("VF_REQUIRE_DB=1 but TEST_DATABASE_URL is not set — the 0350 test did not run");
    });
  });
}

const FILE = "0350_charging_feed_register.sql";

describe.skipIf(url === undefined)("0350 charging feed register", () => {
  const { t, service } = migratedSuite(url ?? "postgresql://x@127.0.0.1/x", "chgreg0350");

  const rows = async (): Promise<string[]> =>
    (
      await t.pool.query<{ r: string }>(
        `select concat_ws('|', feed_key, source_id, role, site_rank, twin_radius_m, stale_after_s, statement_max_age_s,
                frozen_after_s, points_from, to_char(answers_until at time zone 'Europe/Berlin', 'YYYY-MM-DD HH24:MI')) as r
           from public.charging_feed_register order by feed_key`,
      )
    ).rows.map((x) => x.r);

  it("seeds 34 ranked site feeds and 31 status feeds", async () => {
    const all = await rows();
    expect(all).toHaveLength(65);
    expect(all.filter((r) => r.split("|")[2] === "site")).toHaveLength(34);
    expect(all.filter((r) => r.split("|")[2] === "status")).toHaveLength(31);
    expect(all).toContain("afir_enbw_stat|mobilithek_afir_enbw_stat|site|10");
    expect(all).toContain("afir_eliso_stat|mobilithek_afir_eliso_stat|site|9");
    expect(all).toContain("bnetza_lsr|bnetza_lsr|site|90|50");
    expect(all).toContain("afir_ladenetz_stat|mobilithek_afir_ladenetz_stat|site|" + rankOf(all, "afir_ladenetz_stat") + "|2026-10-19 00:00");
    expect(all.filter((r) => r.endsWith("|2026-10-19 00:00")).map((r) => r.split("|")[0])).toEqual([
      "afir_ladebusiness_stat",
      "afir_ladenetz_stat",
    ]);
    expect(all.filter((r) => r.split("|")[4] === "50").map((r) => r.split("|")[0])).toEqual(["bnetza_lsr"]);
  });

  it("each status feed carries its age limits and the site feed it speaks for", async () => {
    const all = await rows();
    expect(all).toContain("ocpdb_taubert_dyn|ocpdb_taubert|status|180|1800|ocpdb_taubert_stat");
    expect(all).toContain("hh_emobility_dyn|hh_emobility|status|900|1800");
    const status = (
      await t.pool.query<{ n: string; pairs: string; frozen: string; sites: string }>(
        `select count(*)::text as n, count(s.points_from)::text as pairs, count(s.frozen_after_s)::text as frozen,
                count(*) filter (where p.role = 'site')::text as sites
           from public.charging_feed_register s left join public.charging_feed_register p on p.feed_key = s.points_from
          where s.role = 'status'`,
      )
    ).rows[0];
    expect(status).toEqual({ n: "31", pairs: "20", frozen: "28", sites: "20" });
  });

  it("the role checks refuse a row of the wrong shape by name", async () => {
    const refuse = async (sql: string, name: string): Promise<void> => {
      await expect(t.planted(async (c) => c.query(sql))).rejects.toThrow(name);
    };
    const ins = "insert into public.charging_feed_register (feed_key, source_id, role, site_rank, stale_after_s, statement_max_age_s, frozen_after_s, points_from) values ";
    await refuse(ins + "('x', 'x', 'site', null, null, null, null, null)", "charging_feed_register_site_check");
    await refuse(ins + "('x', 'x', 'status', 1, 60, 60, null, null)", "charging_feed_register_site_check");
    await refuse(ins + "('x', 'x', 'status', null, null, 60, null, null)", "charging_feed_register_status_check");
    await refuse(ins + "('x', 'x', 'site', 1, null, null, 60, null)", "charging_feed_register_status_check");
    await refuse(ins + "('x', 'x', 'status', null, 60, 60, null, 'nope')", "charging_feed_register_points_from_fkey");
  });

  it("api_reader reads it, energy_page_slugs, feed_run_extents and feed_versions, as itself, and writes none", async () => {
    const as = async <R>(fn: (c: pg.PoolClient) => Promise<R>): Promise<R> =>
      t.planted(async (c) => {
        await c.query("set local role api_reader");
        return fn(c);
      });
    for (const rel of ["public.charging_feed_register", "public.energy_page_slugs", "public.feed_run_extents", "public.feed_versions"]) {
      await expect(as(async (c) => (await c.query(`select count(*) from ${rel}`)).rowCount)).resolves.toBe(1);
    }
    const held = (
      await t.pool.query<{ s: string }>(
        `select x.n || ' ' || p as s from unnest($1::text[]) x(n) cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
          where has_table_privilege('api_reader', x.n, p) order by 1`,
        [["public.charging_feed_register", "public.energy_page_slugs", "public.feed_run_extents", "public.feed_versions"]],
      )
    ).rows.map((r) => r.s);
    expect(held).toEqual(["public.charging_feed_register SELECT", "public.energy_page_slugs SELECT", "public.feed_run_extents SELECT", "public.feed_versions SELECT"]);
  });

  it("the file applied again is a no-op", async () => {
    const was = await rows();
    await t.pool.query("delete from schema_migrations where version = 350");
    const run = await service().migrate("cli");
    expect(run.ok, run.lines.join("\n")).toBe(true);
    expect(run.lines.filter((l) => l.startsWith("applying")).map((l) => l.split(" ")[1])).toEqual([FILE]);
    expect(await rows()).toEqual(was);
  });
});

function rankOf(all: string[], key: string): string {
  return all.find((r) => r.startsWith(key + "|"))?.split("|")[3] ?? "";
}
