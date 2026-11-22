/**
 * 0331: charging_site_twin_claims, charging_point_copies and
 * refresh_charging_derived(feed), the charging reads' two neighbour rules kept
 * by the loads.
 *
 * The proof is an equality, not a list of cases: a seeded neighbourhood of
 * register and other sites (operators, streets, house numbers, postcodes,
 * closed, confidential, with and without live and MCS points) is refreshed,
 * and then
 *   - for every register site, the reader's rule as it is today (the main
 *     repository's registerTwinSql, copied below with its parameters bound)
 *     equals the stored claims plus the tests the reader keeps, both for the
 *     plain rule and for the MCS variant (registerTwinAlsoPublishesSql);
 *   - the stored copies equal every pair of distinct live, publishable points
 *     with the same EVSE id (without '*' and '-') or the same UUID point id.
 * Then the loads change rows and refresh only their own feed, and the two
 * equalities still hold.
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
  describe("0331 charging stored references", () => {
    it("has a database to run against", () => {
      expect.fail("VF_REQUIRE_DB=1 but TEST_DATABASE_URL is not set — the stored-references test did not run");
    });
  });
}

const REG = "bnetza_lsr";
const FEEDS = [REG, "afir_a", "afir_b", "ocpdb_c"] as const;
const LON = 13.405;
const LAT = 52.52;
const M_LAT = 1 / 111_195;
const M_LON = 1 / 67_700;

/** A small deterministic generator, so a failure reproduces. */
const rng = (seed: number): (() => number) => {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1_664_525) + 1_013_904_223) >>> 0;
    return s / 2 ** 32;
  };
};
const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T;

const OPERATORS = ["EnBW mobility+ AG", "EnBW AG", "Allego GmbH", "Tesla Germany GmbH", "Stadtwerke Musterstadt", "Shell Recharge", null] as const;
const STREETS = ["Unter den Linden", "Friedrichstrasse", "Hauptstrasse", null] as const;
const HOUSES = ["1", "2", "2a", null] as const;
const POSTCODES = ["10117", "10115", null] as const;
const PLUGS = [["iec62196T2"], ["iec62196T2COMBO"], ["mcs"], ["iec62196T2COMBO", "mcs"], []] as const;

/** Sites within about 250 m of one centre (dense enough for every arm of the rule), and their points. */
const seed = async (c: pg.ClientBase, s: number): Promise<void> => {
  const r = rng(s);
  const evse = Array.from({ length: 30 }, (_, i) => `DE*ABC*E${String(1000 + i)}`);
  const uuids = Array.from({ length: 15 }, (_, i) => `0b6f6d2c-${String(1000 + i)}-4a1e-9c33-5f2a7c0e9d1${String(i % 10)}`);
  for (let i = 0; i < 70; i++) {
    const feed = i < 25 ? REG : pick(r, FEEDS.slice(1));
    const id = `s${String(i)}`;
    const dx = (r() - 0.5) * 500;
    const dy = (r() - 0.5) * 500;
    await c.query(
      `insert into charging_sites (source_feed, site_id, operator, street, house_number, postcode, geom, closed_at, confidentiality)
       values ($1, $2, $3, $4, $5, $6, ST_SetSRID(ST_MakePoint($7, $8), 4326)::geography, case when $9 then now() end, $10)`,
      [feed, id, pick(r, OPERATORS), pick(r, STREETS), pick(r, HOUSES), pick(r, POSTCODES), LON + dx * M_LON, LAT + dy * M_LAT, r() < 0.08, r() < 0.05 ? "restrictedToClosedUsers" : null],
    );
    const n = Math.floor(r() * 4);
    for (let k = 0; k < n; k++) {
      const key = `${id}-p${String(k)}`;
      // Every other point carries an id another feed may also publish, in one of its spellings.
      const e = r() < 0.6 ? pick(r, evse) : null;
      const spelled = e === null ? null : r() < 0.5 ? e : e.replace(/\*/g, "").toLowerCase();
      const u = r() < 0.35 ? pick(r, uuids) : r() < 0.2 ? `not-a-uuid-${key}` : null;
      await c.query(
        `insert into charging_points (source_feed, point_key, site_id, geom, evse_id, provider_point_id, connector_types, closed_at, confidentiality)
         values ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography, $6, $7, $8, case when $9 then now() end, $10)`,
        [feed, key, id, LON, LAT, spelled, u === null ? null : r() < 0.5 ? u : u.toUpperCase(), pick(r, PLUGS), r() < 0.1, r() < 0.05 ? "restrictedToClosedUsers" : null],
      );
    }
  }
};

const refreshAll = async (c: pg.ClientBase): Promise<void> => {
  for (const f of FEEDS) {
    await c.query("select refresh_charging_twin_pairs($1)", [f]);
    await c.query("select refresh_charging_derived($1)", [f]);
  }
};

const LIVE = (a: string): string => `${a}.closed_at is null and coalesce(${a}.confidentiality, 'noRestriction') = 'noRestriction'`;

/** The main repository's registerTwinSql, as the readers run it today: $1 licensed feeds, $2 register feeds, $3 the twin radius. */
const todaySql = (point: string): string => `
  select n.site_id from charging_sites_live n
   where n.closed_at is null and ${LIVE("n")}
     and (n.source_feed = any($2::text[]) and exists (
        select 1 from (select a.* from charging_site_twin_pairs tp
           cross join lateral (select x.* from charging_sites_live x
                                where x.source_feed = tp.twin_feed and x.site_id = tp.twin_site_id and coalesce(x.confidentiality, 'noRestriction') = 'noRestriction' offset 0) a
          where tp.register_feed = n.source_feed and tp.register_site_id = n.site_id) a
         where a.closed_at is null
           and a.source_feed = any($1::text[])
           and not (a.source_feed = any($2::text[]))
           and coalesce(a.confidentiality, 'noRestriction') = 'noRestriction'
           and ST_DWithin(a.geom, n.geom, greatest($3::float8, 150))
           and ((ST_DWithin(a.geom, n.geom, $3)
           and (a.operator_tokens && n.operator_tokens
                or (a.street_key <> ''
                    and a.street_key = n.street_key
                    and (a.postcode is null or n.postcode is null or a.postcode = n.postcode)
                    and (a.house_key is null or n.house_key is null or a.house_key = n.house_key)
                    and not exists (
                      select 1 from (select r.* from (select y.* from charging_sites_live y
                                      where y.closed_at is null and ST_DWithin(y.geom, a.geom, $3) and coalesce(y.confidentiality, 'noRestriction') = 'noRestriction' offset 0) r
                              where exists (select 1 from charging_site_twin_pairs cp
                                             where cp.register_feed = r.source_feed and cp.register_site_id = r.site_id
                                               and cp.twin_feed = a.source_feed and cp.twin_site_id = a.site_id)) r
                       where r.closed_at is null
                         and r.source_feed = any($2::text[])
                         and coalesce(r.confidentiality, 'noRestriction') = 'noRestriction'
                         and ST_DWithin(r.geom, a.geom, $3)
                         and r.operator_tokens && a.operator_tokens))))
                or (a.operator_tokens && n.operator_tokens
                    and a.street_key <> ''
                    and a.street_key = n.street_key
                    and a.house_key is not null
                    and a.house_key = n.house_key
                    and (a.postcode is null or n.postcode is null or a.postcode = n.postcode)))
           and exists (
             select 1 from charging_points_live ap
              where ap.source_feed = a.source_feed and ap.site_id = a.site_id
                and ap.closed_at is null and coalesce(ap.confidentiality, 'noRestriction') = 'noRestriction'${point})))
   order by 1`;

/** The same answer from the stored claims and the tests the reader keeps. */
const storedSql = (point: string): string => `
  select n.site_id from charging_sites_live n
   where n.closed_at is null and ${LIVE("n")}
     and (n.source_feed = any($2::text[]) and exists (
        select 1 from charging_site_twin_claims cl
          join charging_sites_live a on a.source_feed = cl.twin_feed and a.site_id = cl.twin_site_id
         where cl.register_feed = n.source_feed and cl.register_site_id = n.site_id
           and a.closed_at is null
           and a.source_feed = any($1::text[])
           and not (a.source_feed = any($2::text[]))
           and coalesce(a.confidentiality, 'noRestriction') = 'noRestriction'
           and $3::float8 = 50
           and exists (
             select 1 from charging_points_live ap
              where ap.source_feed = a.source_feed and ap.site_id = a.site_id
                and ap.closed_at is null and coalesce(ap.confidentiality, 'noRestriction') = 'noRestriction'${point})))
   order by 1`;

const MCS = " and ap.connector_types && array['mcs']::text[]";
const ARGS = [FEEDS, [REG], 50];

const sites = async (c: pg.ClientBase, sql: string, args: unknown[] = ARGS): Promise<string[]> => (await c.query<{ site_id: string }>(sql, args)).rows.map((r) => r.site_id);

/** Every ordered pair of distinct live, publishable points sharing a copy key, as the reads' windows group them. */
const COPIES_TODAY = `
  with k as (
    select 'e' as kind, upper(translate(p.evse_id, '*-', '')) as norm, p.source_feed, p.point_key, p.site_id from charging_points_live p
     where ${LIVE("p")} and p.evse_id is not null
    union all
    select 'u', lower(p.provider_point_id), p.source_feed, p.point_key, p.site_id from charging_points_live p
     where ${LIVE("p")} and p.provider_point_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
  select a.source_feed || ':' || a.point_key || ' ' || a.kind || ' ' || b.source_feed || ':' || b.point_key || '@' || b.site_id as r
    from k a join k b on a.kind = b.kind and a.norm = b.norm and not (a.source_feed = b.source_feed and a.point_key = b.point_key)
   order by 1`;
const COPIES_STORED = `
  select source_feed || ':' || point_key || ' ' || kind || ' ' || copy_feed || ':' || copy_point_key || '@' || copy_site_id as r
    from charging_point_copies order by 1`;
const rows = async (c: pg.ClientBase, sql: string): Promise<string[]> => (await c.query<{ r: string }>(sql)).rows.map((x) => x.r);

const expectEqual = async (c: pg.ClientBase): Promise<{ claims: number; copies: number }> => {
  const plain = await sites(c, todaySql(""));
  expect(await sites(c, storedSql(""))).toEqual(plain);
  const mcs = await sites(c, todaySql(MCS));
  expect(await sites(c, storedSql(MCS))).toEqual(mcs);
  // A licence that leaves out a feed: the reader's own test, the same both ways.
  const some = [REG, "afir_a"];
  expect(await sites(c, storedSql(""), [some, [REG], 50])).toEqual(await sites(c, todaySql(""), [some, [REG], 50]));
  const copies = await rows(c, COPIES_TODAY);
  expect(await rows(c, COPIES_STORED)).toEqual(copies);
  return { claims: plain.length, copies: copies.length };
};

describe.skipIf(url === undefined)("0331 charging stored references", () => {
  const { t } = migratedSuite(url ?? "postgresql://x@127.0.0.1/x", "chargingrefs");

  it("are two tables keyed by their references, an index from the copy's side, fixed autovacuum thresholds", async () => {
    const cols = async (tb: string): Promise<string[]> =>
      (
        await t.pool.query<{ c: string }>(
          "select column_name || ' ' || data_type || ' ' || is_nullable as c from information_schema.columns where table_schema = 'public' and table_name = $1 order by ordinal_position",
          [tb],
        )
      ).rows.map((r) => r.c);
    expect(await cols("charging_site_twin_claims")).toEqual(["register_feed text NO", "register_site_id text NO", "twin_feed text NO", "twin_site_id text NO"]);
    expect(await cols("charging_point_copies")).toEqual(["source_feed text NO", "point_key text NO", "kind text NO", "copy_feed text NO", "copy_point_key text NO", "copy_site_id text NO"]);
    const ix = (
      await t.pool.query<{ d: string }>("select pg_get_indexdef(indexrelid) as d from pg_index where indrelid = 'public.charging_point_copies'::regclass order by 1")
    ).rows.map((r) => r.d);
    expect(ix).toEqual([
      "CREATE INDEX charging_point_copies_copy ON public.charging_point_copies USING btree (copy_feed, copy_point_key)",
      "CREATE UNIQUE INDEX charging_point_copies_pkey ON public.charging_point_copies USING btree (source_feed, point_key, kind, copy_feed, copy_point_key)",
    ]);
    for (const tb of ["charging_site_twin_claims", "charging_point_copies"]) {
      const opts = (await t.pool.query<{ o: string[] }>("select reloptions as o from pg_class where oid = $1::regclass", [`public.${tb}`])).rows[0]?.o;
      expect([...(opts ?? [])].sort()).toEqual(
        ["autovacuum_analyze_scale_factor=0", "autovacuum_analyze_threshold=2000", "autovacuum_vacuum_insert_scale_factor=0", "autovacuum_vacuum_insert_threshold=2000", "autovacuum_vacuum_scale_factor=0", "autovacuum_vacuum_threshold=2000"].sort(),
      );
    }
  });

  it("refuses a refresh that names no feed", async () => {
    for (const feed of ["", null]) {
      await t.planted(async (c) => {
        await expect(c.query("select refresh_charging_derived($1)", [feed])).rejects.toThrow(/name the feed/);
      });
    }
  });

  it("equal today's rule and today's copies over six seeded neighbourhoods, each with something to compare", async () => {
    for (const s of [1, 2, 3, 4, 5, 6]) {
      await t.planted(async (c) => {
        await seed(c, s);
        await refreshAll(c);
        const n = await expectEqual(c);
        expect(n.claims, `seed ${String(s)}`).toBeGreaterThan(0);
        expect(n.copies, `seed ${String(s)}`).toBeGreaterThan(0);
      });
    }
  });

  it("still equal after each load refreshes only its own feed: sites closed, reopened, renamed, moved; points closed, re-keyed, made confidential", async () => {
    await t.planted(async (c) => {
      await seed(c, 7);
      await refreshAll(c);
      await expectEqual(c);
      // afir_a's release.
      await c.query("update charging_sites set closed_at = now() where source_feed = 'afir_a' and site_id in (select site_id from charging_sites where source_feed = 'afir_a' order by site_id limit 2)");
      await c.query("update charging_sites set operator = 'EnBW AG' where source_feed = 'afir_a' and closed_at is null");
      await c.query("update charging_points set evse_id = 'DE*ABC*E1001' where source_feed = 'afir_a' and point_key in (select point_key from charging_points where source_feed = 'afir_a' order by point_key limit 3)");
      await c.query("update charging_points set closed_at = now() where source_feed = 'afir_a' and point_key in (select point_key from charging_points where source_feed = 'afir_a' order by point_key desc limit 2)");
      await c.query("select refresh_charging_twin_pairs('afir_a')");
      await c.query("select refresh_charging_derived('afir_a')");
      await expectEqual(c);
      // The register's release: a register site reopened, one renamed, one moved next to an afir_b site.
      await c.query("update charging_sites set closed_at = null where source_feed = $1", [REG]);
      await c.query("update charging_sites set operator = 'Allego GmbH' where source_feed = $1 and site_id = 's3'", [REG]);
      await c.query(
        "update charging_sites r set geom = b.geom from (select geom from charging_sites where source_feed = 'afir_b' order by site_id limit 1) b where r.source_feed = $1 and r.site_id = 's4'",
        [REG],
      );
      await c.query("select refresh_charging_twin_pairs($1)", [REG]);
      await c.query("select refresh_charging_derived($1)", [REG]);
      await expectEqual(c);
      // ocpdb_c's release: points made confidential, a point moved to another site of its feed.
      await c.query("update charging_points set confidentiality = 'restrictedToClosedUsers' where source_feed = 'ocpdb_c' and point_key in (select point_key from charging_points where source_feed = 'ocpdb_c' order by point_key limit 2)");
      await c.query(
        "update charging_points p set site_id = (select site_id from charging_sites where source_feed = 'ocpdb_c' order by site_id desc limit 1) where p.source_feed = 'ocpdb_c' and p.point_key = (select point_key from charging_points where source_feed = 'ocpdb_c' order by point_key desc limit 1)",
      );
      await c.query("select refresh_charging_twin_pairs('ocpdb_c')");
      await c.query("select refresh_charging_derived('ocpdb_c')");
      await expectEqual(c);
    });
  });

  it("the ingestor role runs the refresh as the owner; the readers may read both tables and neither refresh them nor list the copy keys", async () => {
    await t.asSource(null, async (c) => {
      expect((await c.query<{ n: number }>("select refresh_charging_derived($1) as n", [REG])).rows[0]?.n).toBe(0);
    });
    for (const role of ["viafrei_digest", "viafrei_mcp"]) {
      await t.planted(async (c) => {
        await c.query(`set local role ${role}`);
        for (const tb of ["charging_site_twin_claims", "charging_point_copies"]) {
          expect((await c.query<{ n: number }>(`select count(*)::int as n from ${tb}`)).rows[0]?.n).toBe(0);
        }
        for (const call of ["select refresh_charging_derived('bnetza_lsr')", "select * from charging_point_copy_keys(null)"]) {
          await c.query("savepoint s");
          const err = await c.query(call).then(
            () => null,
            (e: unknown) => e as { code?: string },
          );
          await c.query("rollback to savepoint s");
          expect(err?.code).toBe("42501");
        }
      });
    }
  });

  it("a copy is of one of two kinds", async () => {
    await t.planted(async (c) => {
      const err = await c
        .query("insert into charging_point_copies values ('afir_a', 'p', 'x', 'afir_b', 'q', 's')")
        .then(() => null, (e: unknown) => e as { code?: string; constraint?: string });
      expect(err?.code).toBe("23514");
      expect(err?.constraint).toBe("charging_point_copies_kind");
    });
  });

  it("a refresh that finds nothing changed writes no row", async () => {
    await t.planted(async (c) => {
      await seed(c, 8);
      await refreshAll(c);
      for (const f of FEEDS) {
        expect((await c.query<{ n: number }>("select refresh_charging_derived($1) as n", [f])).rows[0]?.n).toBe(0);
      }
    });
  });
});
