/**
 * 0326: charging_site_twin_pairs and refresh_charging_twin_pairs(feed), the
 * register-twin rule's candidate pairs kept by the loads.
 *
 * A pair is a register site and a site of another feed, both open, within
 * 150 m, sharing an operator token or a non-empty street key. The refresh of a
 * register feed rebuilds its register side, of any other feed its twin side;
 * rows that still hold stay untouched; the refreshes run one at a time.
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
  describe("0326 charging_site_twin_pairs", () => {
    it("has a database to run against", () => {
      expect.fail("VF_REQUIRE_DB=1 but TEST_DATABASE_URL is not set — the twin-pairs test did not run");
    });
  });
}

const REG = "bnetza_lsr";
/** Berlin Mitte; one metre north is about 0.000009 degrees of latitude. */
const LON = 13.405;
const LAT = 52.52;
const north = (m: number): number => LAT + m / 111_195;

type Site = { feed: string; id: string; m: number; operator?: string; street?: string; closed?: boolean };

const plant = async (c: pg.ClientBase, sites: readonly Site[]): Promise<void> => {
  for (const s of sites) {
    await c.query(
      `insert into charging_sites (source_feed, site_id, operator, street, house_number, geom, closed_at)
       values ($1, $2, $3, $4, '1', ST_SetSRID(ST_MakePoint($5, $6), 4326)::geography, case when $7 then now() end)`,
      [s.feed, s.id, s.operator ?? null, s.street ?? null, LON, north(s.m), s.closed === true],
    );
  }
};

const pairs = async (c: pg.ClientBase): Promise<string[]> =>
  (
    await c.query<{ p: string }>(
      "select register_feed || ':' || register_site_id || ' ' || twin_feed || ':' || twin_site_id as p from charging_site_twin_pairs order by 1",
    )
  ).rows.map((r) => r.p);

const refresh = async (c: pg.ClientBase, feed: string | null): Promise<number> =>
  (await c.query<{ n: number }>("select refresh_charging_twin_pairs($1) as n", [feed])).rows[0]?.n ?? -1;

/** The register site at 0 m and its neighbours: two pairs, and one of each way a pair is refused. */
const AROUND: readonly Site[] = [
  { feed: REG, id: "r1", m: 0, operator: "EnBW mobility+ AG", street: "Unter den Linden" },
  { feed: "afir_a", id: "op40", m: 40, operator: "EnBW AG", street: "Friedrichstrasse" },
  { feed: "afir_a", id: "street100", m: 100, operator: "Allego", street: "Unter den Linden" },
  { feed: "afir_a", id: "other30", m: 30, operator: "Allego", street: "Friedrichstrasse" },
  { feed: "afir_a", id: "far160", m: 160, operator: "EnBW", street: "Unter den Linden" },
  { feed: "afir_a", id: "closed20", m: 20, operator: "EnBW", closed: true },
  { feed: "afir_b", id: "b10", m: 10, operator: "EnBW" },
  // No street on either side and no operator in common: two empty street keys are not one street.
  { feed: "afir_a", id: "nostreet60", m: 60, operator: "Allego" },
  { feed: REG, id: "r2", m: 5, operator: "EnBW", closed: true },
  { feed: REG, id: "r3", m: 12, operator: "Tesla" },
];

describe.skipIf(url === undefined)("0326 charging_site_twin_pairs", () => {
  const { t } = migratedSuite(url ?? "postgresql://x@127.0.0.1/x", "twinpairs");

  it("is a table of four keys, its primary key the pair, an index from the twin's side, fixed autovacuum thresholds", async () => {
    const cols = (
      await t.pool.query<{ c: string }>(
        "select column_name || ' ' || data_type || ' ' || is_nullable as c from information_schema.columns where table_schema = 'public' and table_name = 'charging_site_twin_pairs' order by ordinal_position",
      )
    ).rows.map((r) => r.c);
    expect(cols).toEqual(["register_feed text NO", "register_site_id text NO", "twin_feed text NO", "twin_site_id text NO"]);
    const ix = (
      await t.pool.query<{ d: string }>("select pg_get_indexdef(indexrelid) as d from pg_index where indrelid = 'public.charging_site_twin_pairs'::regclass order by 1")
    ).rows.map((r) => r.d);
    expect(ix).toEqual([
      "CREATE INDEX charging_site_twin_pairs_twin ON public.charging_site_twin_pairs USING btree (twin_feed, twin_site_id)",
      "CREATE UNIQUE INDEX charging_site_twin_pairs_pkey ON public.charging_site_twin_pairs USING btree (register_feed, register_site_id, twin_feed, twin_site_id)",
    ]);
    const opts = (await t.pool.query<{ o: string[] }>("select reloptions as o from pg_class where oid = 'public.charging_site_twin_pairs'::regclass")).rows[0]?.o;
    expect([...(opts ?? [])].sort()).toEqual(
      [
        "autovacuum_analyze_scale_factor=0",
        "autovacuum_analyze_threshold=2000",
        "autovacuum_vacuum_insert_scale_factor=0",
        "autovacuum_vacuum_insert_threshold=2000",
        "autovacuum_vacuum_scale_factor=0",
        "autovacuum_vacuum_threshold=2000",
      ].sort(),
    );
    expect((await t.pool.query<{ f: string[] }>("select charging_twin_register_feeds() as f")).rows[0]?.f).toEqual([REG]);
  });

  it("a register refresh pairs each open register site with the open sites of other feeds within 150 m that share an operator token or a street", async () => {
    await t.planted(async (c) => {
      await plant(c, AROUND);
      expect(await refresh(c, REG)).toBe(3);
      expect(await pairs(c)).toEqual([`${REG}:r1 afir_a:op40`, `${REG}:r1 afir_a:street100`, `${REG}:r1 afir_b:b10`]);
    });
  });

  it("a feed's refresh rebuilds only the pairs of its own sites: what went is deleted, what is new inserted, every other feed's pair left alone", async () => {
    await t.planted(async (c) => {
      await plant(c, AROUND);
      await refresh(c, REG);
      // afir_a's release: op40 closed, other30 renamed to the register's operator, and a new site of its street.
      await c.query("update charging_sites set closed_at = now() where source_feed = 'afir_a' and site_id = 'op40'");
      await c.query("update charging_sites set operator = 'EnBW' where source_feed = 'afir_a' and site_id = 'other30'");
      await plant(c, [{ feed: "afir_a", id: "new90", m: 90, operator: "Allego", street: "Unter den Linden" }]);
      // b10 moves away, but afir_b is not refreshed: its pair stays until its own load.
      await c.query("update charging_sites set geom = ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography where source_feed = 'afir_b'", [LON, north(5000)]);
      expect(await refresh(c, "afir_a")).toBe(2);
      expect(await pairs(c)).toEqual([`${REG}:r1 afir_a:new90`, `${REG}:r1 afir_a:other30`, `${REG}:r1 afir_a:street100`, `${REG}:r1 afir_b:b10`]);
      expect(await refresh(c, "afir_b")).toBe(0);
      expect(await pairs(c)).toEqual([`${REG}:r1 afir_a:new90`, `${REG}:r1 afir_a:other30`, `${REG}:r1 afir_a:street100`]);
    });
  });

  it("a register refresh pairs a register site reopened or renamed by its load, and drops the pairs of one it closed", async () => {
    await t.planted(async (c) => {
      await plant(c, AROUND);
      await refresh(c, REG);
      await c.query("update charging_sites set closed_at = null where source_feed = $1 and site_id = 'r2'", [REG]);
      await c.query("update charging_sites set closed_at = now() where source_feed = $1 and site_id = 'r1'", [REG]);
      await c.query("update charging_sites set operator = 'Allego' where source_feed = $1 and site_id = 'r3'", [REG]);
      await refresh(c, REG);
      expect(await pairs(c)).toEqual([`${REG}:r2 afir_a:op40`, `${REG}:r2 afir_b:b10`, `${REG}:r3 afir_a:nostreet60`, `${REG}:r3 afir_a:other30`, `${REG}:r3 afir_a:street100`]);
    });
  });

  it("a refresh that finds nothing changed writes no row", async () => {
    await t.planted(async (c) => {
      await plant(c, AROUND);
      await refresh(c, REG);
      const before = (await c.query<{ x: string }>("select string_agg(ctid::text, ',' order by ctid) as x from charging_site_twin_pairs")).rows[0]?.x;
      expect(await refresh(c, REG)).toBe(0);
      expect(await refresh(c, "afir_a")).toBe(0);
      const after = (await c.query<{ x: string }>("select string_agg(ctid::text, ',' order by ctid) as x from charging_site_twin_pairs")).rows[0]?.x;
      expect(after).toBe(before);
    });
  });

  it("refuses a missing feed before it locks or writes anything", async () => {
    await t.planted(async (c) => {
      for (const feed of [null, ""]) {
        await c.query("savepoint s");
        const err = await refresh(c, feed).then(
          () => null,
          (e: unknown) => e as { code?: string; message?: string },
        );
        await c.query("rollback to savepoint s");
        expect(err?.code).toBe("22023");
        expect(err?.message).toContain("name the feed");
      }
      expect((await c.query<{ n: number }>("select count(*)::int as n from pg_locks where locktype = 'advisory' and pid = pg_backend_pid()")).rows[0]?.n).toBe(0);
    });
  });

  it("runs one refresh at a time: a second waits for the first's transaction, whatever the feed", async () => {
    const a = await t.pool.connect();
    const b = await t.pool.connect();
    try {
      await a.query("begin");
      await refresh(a, "afir_a");
      await b.query("begin");
      await b.query("set local lock_timeout = '300ms'");
      const err = await refresh(b, REG).then(
        () => null,
        (e: unknown) => e as { code?: string },
      );
      expect(err?.code).toBe("55P03");
      await b.query("rollback");
      await a.query("rollback");
      await b.query("begin");
      await b.query("set local lock_timeout = '300ms'");
      expect(await refresh(b, REG)).toBe(0);
      await b.query("rollback");
    } finally {
      a.release();
      b.release();
    }
  });

  it("the ingestor role runs the refresh as the owner; the readers may read the pairs and not refresh them", async () => {
    await t.asSource(null, async (c) => {
      expect(await refresh(c, REG)).toBe(0);
    });
    for (const role of ["viafrei_digest", "viafrei_mcp"]) {
      await t.planted(async (c) => {
        await c.query(`set local role ${role}`);
        expect((await c.query<{ n: number }>("select count(*)::int as n from charging_site_twin_pairs")).rows[0]?.n).toBe(0);
        await c.query("savepoint s");
        const err = await refresh(c, REG).then(
          () => null,
          (e: unknown) => e as { code?: string },
        );
        await c.query("rollback to savepoint s");
        expect(err?.code).toBe("42501");
      });
    }
  });
});
