/**
 * 0322 and the two maintenance commands (owner 2026-11-19: all database
 * processing lives in this project), on both paths a database takes:
 *
 *   1  a database migrated from empty: gtfs_derived_refresh,
 *      osm_street_tiles_refresh and analyze_after_load by behaviour (each
 *      view rebuilt from its table under its own session, the caller's
 *      settings untouched, every other name refused, PUBLIC and the readers
 *      refused, viafrei_ingestor allowed), and energy_page_keys' autovacuum
 *      parameters;
 *   2  production's history: a database at 0321 (production's head after
 *      this release's earlier files) migrated to head applies 0322 alone and
 *      ends with the same functions, grants and parameters as path 1;
 *   3  `partitions retain` over planted days: a dry run changes nothing, an
 *      apply drops exactly the days past partition_retention's window (a
 *      pending detach finalized first, a detached leftover too), stamps the
 *      archive rows, holds a day the ledger says was dropped, and a failed
 *      drop leaves the others done;
 *   4  `reclaim`: refused while the prune is not done or the GTFS write lock is
 *      held, a dry run rewrites nothing, a run rewrites both tables, and a
 *      rewrite that cannot take its lock fails without waiting past 5 s.
 *
 *   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/empty npm run test:db
 */
import { mkdtempSync, mkdirSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { DatabaseService } from "../src/service.js";
import { addDays, retain, utcDay } from "../src/retain.js";
import { GTFS_WRITE_LOCK, reclaim } from "../src/reclaim.js";
import { DomainDb, endPool } from "./domain-db.js";
import { REPO } from "./helpers.js";
import { one, refused, requireDb, rows, url } from "./schema-db.js";

requireDb("0322 and the maintenance commands");

const quiet = { info: () => undefined, warn: () => undefined, error: () => undefined };
const FUNCTIONS = ["analyze_after_load(text[])", "gtfs_derived_refresh(text)", "osm_street_tiles_refresh(text)"];
const ENERGY_OPTIONS = [
  "autovacuum_analyze_scale_factor=0",
  "autovacuum_analyze_threshold=5000",
  "autovacuum_vacuum_cost_delay=0",
  "autovacuum_vacuum_insert_scale_factor=0",
  "autovacuum_vacuum_insert_threshold=5000",
  "autovacuum_vacuum_scale_factor=0",
  "autovacuum_vacuum_threshold=5000",
];

type Fn = { fn: string; definer: boolean; config: string[]; acl: string[] };

/** The three functions as the catalogue holds them: definer, settings, and who may execute (the owner shown as `owner`). */
async function functions(q: pg.Pool): Promise<Fn[]> {
  return (
    await q.query<Fn>(
      `select p.oid::regprocedure::text as fn, p.prosecdef as definer, coalesce(p.proconfig, '{}') as config,
              array(select case when a.grantee = p.proowner then 'owner' when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end || ':' || a.privilege_type
                      from aclexplode(p.proacl) a order by 1) as acl
         from pg_proc p where p.oid::regprocedure::text = any ($1) order by 1`,
      [FUNCTIONS],
    )
  ).rows;
}

const energyOptions = async (q: pg.Pool): Promise<string[]> =>
  ((await one<{ o: string[] }>(q, "select coalesce(reloptions, '{}') as o from pg_class where oid = 'public.energy_page_keys'::regclass")).o).sort();

describe.skipIf(url === undefined)("0322 and the maintenance commands", () => {
  const t = new DomainDb(url ?? "postgresql://x@127.0.0.1/x", "maint0322");

  beforeAll(async () => {
    await t.make([]);
  }, 900_000);

  afterAll(async () => {
    await t.drop();
  });

  describe("1 — a database migrated from empty", () => {
    it("holds the three functions as SECURITY DEFINER with a fixed search_path, the GTFS one with its build session; the owner and viafrei_ingestor execute them, PUBLIC does not", async () => {
      expect(await functions(t.pool)).toEqual([
        { fn: "analyze_after_load(text[])", definer: true, config: ["search_path=public, pg_temp"], acl: ["owner:EXECUTE", "viafrei_ingestor:EXECUTE"] },
        {
          fn: "gtfs_derived_refresh(text)",
          definer: true,
          config: ["search_path=public, pg_temp", "max_parallel_workers_per_gather=0", "hash_mem_multiplier=1", "jit=off", "temp_file_limit=6GB", "work_mem=16MB"],
          acl: ["owner:EXECUTE", "viafrei_ingestor:EXECUTE"],
        },
        { fn: "osm_street_tiles_refresh(text)", definer: true, config: ["search_path=public, pg_temp"], acl: ["owner:EXECUTE", "viafrei_ingestor:EXECUTE"] },
      ]);
    });

    it("gtfs_derived_refresh rebuilds one view per call from the timetable, each under its own work_mem, and leaves the caller's session as it was", async () => {
      await t.planted(async (c) => {
        await c.query(`insert into stop_times (gtfs_feed_key, trip_id, stop_id, stop_sequence, arrival, departure) values
          (1, 'U1', 'a', 0, '08:00', '08:00'), (1, 'U1', 'b', 1, '08:00', '08:00'),
          (1, 'T1', 'a', 0, '08:00', '08:00'), (1, 'T1', 'b', 1, '08:05', '08:05')`);
        const before = await one<{ w: string; j: string }>(c, "select current_setting('work_mem') as w, current_setting('jit') as j");
        expect(await rows(c, "select trip_id from gtfs_untimed_trips")).toEqual([]);
        const lines: string[] = [];
        for (const v of ["gtfs_untimed_trips", "gtfs_route_kreise", "transit_stop_modes"]) lines.push((await one<{ l: string }>(c, "select gtfs_derived_refresh($1) as l", [v])).l);
        expect(lines).toEqual(
          [
            ["gtfs_untimed_trips", "82MB"],
            ["gtfs_route_kreise", "27MB"],
            ["transit_stop_modes", "16MB"],
          ].map(([v, m]) => `refresh materialized view concurrently public.${v ?? ""} (work_mem ${m ?? ""}, hash_mem_multiplier 1, max_parallel_workers_per_gather 0, jit off, temp_file_limit 6GB)`),
        );
        expect(await rows(c, "select gtfs_feed_key, trip_id from gtfs_untimed_trips")).toEqual([{ gtfs_feed_key: 1, trip_id: "U1" }]);
        expect(await one(c, "select current_setting('work_mem') as w, current_setting('jit') as j")).toEqual(before);
      });
    });

    it("osm_street_tiles_refresh rebuilds each street view from osm_streets, one per call", async () => {
      await t.planted(async (c) => {
        await c.query(`insert into osm_streets (osm_id, cls, geom, geom_lo, extract_date, last_seen_at) values
          (1, 3, st_geomfromtext('LINESTRING(500000 5500000, 500100 5500000)', 25832), st_geomfromtext('LINESTRING(500000 5500000, 500100 5500000)', 25832), current_date, now())`);
        const count = async (): Promise<{ hi: number; lo: number }> => one(c, "select (select count(*)::int from osm_street_tiles) as hi, (select count(*)::int from osm_street_tiles_lo) as lo");
        expect(await count()).toEqual({ hi: 0, lo: 0 });
        await c.query("select osm_street_tiles_refresh('osm_street_tiles')");
        expect(await count()).toEqual({ hi: 1, lo: 0 });
        await c.query("select osm_street_tiles_refresh('osm_street_tiles_lo')");
        expect(await count()).toEqual({ hi: 1, lo: 1 });
      });
    });

    it("analyze_after_load analyses the named loaded tables, in the caller's transaction, and refuses the whole call over any other name", async () => {
      await t.planted(async (c) => {
        await c.query("insert into stop_times (gtfs_feed_key, trip_id, stop_id, stop_sequence) select 1, 'A' || g, 's', 0 from generate_series(1, 50) g");
        const tuples = async (): Promise<number> => (await one<{ n: number }>(c, "select reltuples::int as n from pg_class where oid = 'public.stop_times'::regclass")).n;
        expect(await tuples()).toBeLessThan(50);
        expect(await refused(c, "select analyze_after_load('stop_times', 'pg_class')")).toMatchObject({ code: "22023", message: expect.stringMatching(/^analyze_after_load: pg_class not analysed here; the tables are gtfs_service_dates, routes, stops, trips, stop_times, osm_addresses, osm_pois, osm_streets, osm_speed_cameras$/) as unknown });
        expect(await tuples()).toBeLessThan(50);
        await c.query("select analyze_after_load('trips', 'stop_times')");
        expect(await tuples()).toBe(50);
        await c.query("select analyze_after_load('gtfs_service_dates', 'routes', 'stops', 'osm_addresses', 'osm_pois', 'osm_streets', 'osm_speed_cameras')");
        expect((await refused(c, "select analyze_after_load(variadic '{}'::text[])"))?.message).toBe("analyze_after_load: name at least one table");
        expect((await refused(c, "select analyze_after_load(variadic null::text[])"))?.message).toBe("analyze_after_load: name at least one table");
        expect((await refused(c, "select analyze_after_load('stops', null)"))?.message).toMatch(/^analyze_after_load: NULL not analysed here/);
      });
    });

    it("both refresh functions refuse any other view, and NULL, before anything runs", async () => {
      await t.planted(async (c) => {
        expect(await refused(c, "select gtfs_derived_refresh('osm_street_tiles')")).toMatchObject({ code: "22023", message: "gtfs_derived_refresh: osm_street_tiles is not one of gtfs_untimed_trips, gtfs_route_kreise, transit_stop_modes" });
        expect((await refused(c, "select gtfs_derived_refresh(null)"))?.message).toBe("gtfs_derived_refresh: NULL is not one of gtfs_untimed_trips, gtfs_route_kreise, transit_stop_modes");
        expect(await refused(c, "select osm_street_tiles_refresh('gtfs_untimed_trips')")).toMatchObject({ code: "22023", message: "osm_street_tiles_refresh: gtfs_untimed_trips is not one of osm_street_tiles, osm_street_tiles_lo" });
        expect((await refused(c, "select osm_street_tiles_refresh(null)"))?.message).toBe("osm_street_tiles_refresh: NULL is not one of osm_street_tiles, osm_street_tiles_lo");
      });
    });

    it("viafrei_ingestor runs them as the owner; a reader role is refused", async () => {
      await t.planted(async (c) => {
        await c.query("set local role viafrei_ingestor");
        await c.query("select gtfs_derived_refresh('gtfs_untimed_trips'), osm_street_tiles_refresh('osm_street_tiles'), analyze_after_load('stops')");
        await c.query("reset role");
        await c.query("set local role viafrei_mcp");
        for (const sql of ["select gtfs_derived_refresh('gtfs_untimed_trips')", "select osm_street_tiles_refresh('osm_street_tiles')", "select analyze_after_load('stops')"]) {
          expect((await refused(c, sql))?.code).toBe("42501");
        }
      });
    });

    it("energy_page_keys carries the autovacuum parameters of a full rewrite per refresh: fixed thresholds of 5 000 rows, no scale factor, no cost delay", async () => {
      expect(await energyOptions(t.pool)).toEqual(ENERGY_OPTIONS);
    });
  });

  describe("2 — production's history: a database at 0321 migrated to head", () => {
    const name = `test_vfdb_hist0322_${String(process.pid)}`;
    const admin = new pg.Pool({ connectionString: url ?? "postgresql://x@127.0.0.1/x", max: 1 });
    const own = new URL(url ?? "postgresql://x@127.0.0.1/x");
    own.pathname = `/${name}`;
    const dir = mkdtempSync(join(tmpdir(), "vfdb-hist0322-"));
    let pool: pg.Pool | undefined;
    const svc = (env: Record<string, string>): DatabaseService => new DatabaseService({ config: loadConfig({ DATABASE_URL: own.toString(), DB_MIGRATE_LOCK_PAUSE_S: "1", ...env }, "serve"), log: quiet });

    beforeAll(async () => {
      const mig = join(dir, "migrations");
      mkdirSync(mig);
      for (const f of readdirSync(join(REPO, "db", "migrations")).filter((n) => /^\d{4}_.*\.sql$/.test(n) && Number(n.slice(0, 4)) <= 321)) symlinkSync(join(REPO, "db", "migrations", f), join(mig, f));
      await admin.query(`drop database if exists ${name} with (force)`);
      await admin.query(`create database ${name}`);
      const old = svc({ VF_DB_MIGRATIONS_DIR: mig });
      try {
        await old.boot(1_000);
      } finally {
        await endPool(old.pool, () => old.close());
      }
      pool = new pg.Pool({ connectionString: own.toString(), max: 2 });
    }, 900_000);

    afterAll(async () => {
      if (pool !== undefined) await endPool(pool);
      await admin.query(`drop database if exists ${name} with (force)`);
      await admin.end();
      rmSync(dir, { recursive: true, force: true });
    });

    it("applies 0322 alone and ends with path 1's functions, grants and energy_page_keys parameters", async () => {
      const p = pool as pg.Pool;
      expect(await functions(p)).toEqual([]);
      expect(await energyOptions(p)).toEqual(["autovacuum_vacuum_scale_factor=0.05"]);
      const s = svc({});
      try {
        const run = await s.migrate("cli");
        expect(run.ok, run.lines.join("\n")).toBe(true);
        expect(run.lines.filter((l) => l.startsWith("applying"))).toEqual(["applying 0322_db_owned_maintenance.sql"]);
      } finally {
        await endPool(s.pool, () => s.close());
      }
      expect(await functions(p)).toEqual(await functions(t.pool));
      expect(await energyOptions(p)).toEqual(ENERGY_OPTIONS);
    });
  });

  describe("3 — partitions retain", () => {
    const T = utcDay(new Date());
    const d = (n: number): string => addDays(T, -n);
    const rel = (table: string, n: number): string => `${table}_${d(n).replaceAll("-", "")}`;
    const exists = async (r: string): Promise<boolean> => (await one<{ e: boolean }>(t.pool, "select to_regclass($1) is not null as e", [`public.${r}`])).e;
    const plant = async (table: string, n: number, row: boolean): Promise<void> => {
      await t.pool.query(`create table public.${rel(table, n)} partition of public.${table} for values from ('${d(n)}') to ('${d(n - 1)}')`);
      if (row) await t.pool.query(`insert into public.transit_delays (observed_at, feed_ts, trip_id) values ('${d(n)} 12:00+00', '${d(n)} 12:00+00', 'x')`);
    };
    const archive = (n: number, dropped: string | null, restored: string | null, rowCount = 0): Promise<unknown> =>
      t.pool.query("insert into partition_archives (table_name, day, path, bytes, rows, sha256, dropped_at, restored_at) values ($1, $2::date, 'pg/x.dump', 1, $5, repeat('a', 64), $3, $4)", [
        n < 30 ? "transit_delays" : "fuel_prices",
        d(n),
        dropped,
        restored,
        rowCount,
      ]);
    const fuelRow = (n: number, station: string): Promise<unknown> =>
      t.pool.query(`insert into public.fuel_prices (observed_at, station_id, product, price) values ('${d(n)} 12:00+00', $1, 'e5', 1.799)`, [station]);
    const service = (): DatabaseService => new DatabaseService({ config: loadConfig({ DATABASE_URL: t.url }, "cli"), log: quiet });

    beforeAll(async () => {
      await plant("transit_delays", 6, true);
      await archive(6, null, null);
      await plant("transit_delays", 8, true);
      await plant("transit_delays", 9, true);
      await t.pool.query(`create table public.${rel("transit_delays", 7)} (like public.transit_delays)`);
      await t.pool.query(`create table public.transit_delays_misc partition of public.transit_delays for values from ('${d(60)}') to ('${d(50)}')`);
      // The detached leftover has a ledger row from before the policy: it is dropped all the same, and the row stamped.
      await archive(7, null, null);
      for (const n of [40, 41, 42, 43, 44, 45]) await plant("fuel_prices", n, false);
      await archive(41, null, null);
      // 44: the dump recorded one row, and a second was written after it: held, never dropped.
      await fuelRow(44, "st-1");
      await archive(44, null, null, 1);
      await fuelRow(44, "st-2");
      // 45: a crash between the cold store's row and its drop (the drop-only day): its one row is the one recorded, so it goes.
      await fuelRow(45, "st-1");
      await archive(45, null, null, 1);
      await archive(42, "2026-01-02", null);
      await archive(43, "2026-01-02", "2026-01-03");
      // A detach left pending: a reader's open snapshot outlives the statement's timeout.
      const reader = await t.pool.connect();
      const detacher = await t.pool.connect();
      try {
        await reader.query("begin isolation level repeatable read");
        await reader.query("select count(*) from public.transit_delays");
        await detacher.query("set statement_timeout = '1500ms'");
        await expect(detacher.query(`alter table public.transit_delays detach partition public.${rel("transit_delays", 8)} concurrently`)).rejects.toThrow(/statement timeout/);
        await reader.query("commit");
      } finally {
        reader.release();
        detacher.release(true);
      }
      expect((await one<{ p: boolean }>(t.pool, "select inhdetachpending as p from pg_inherits where inhrelid = $1::regclass", [`public.${rel("transit_delays", 8)}`])).p).toBe(true);
    }, 120_000);

    it("a dry run lists what it would drop, waits for the dumps, holds the day the ledger says is gone, and changes nothing (exit 4)", async () => {
      const s = service();
      try {
        const r = await s.retainPartitions("cli", false);
        expect(r.exitCode).toBe(4);
        expect(r.lines.filter((l) => /^[·⚠–]/.test(l))).toEqual([
          `– ${rel("fuel_prices", 43)}: past its 28 days, waiting for the cold store to record its fresh dump (restored since its drop)`,
          `⚠ ${rel("fuel_prices", 42)}: HELD — partition_archives says it was dropped and no restore since explains why it exists; not dropped until somebody has looked`,
          `– ${rel("fuel_prices", 40)}: past its 28 days, waiting for the cold store to record its dump`,
          "– transit_delays_misc: not a <table>_YYYYMMDD partition of exactly that UTC day; not touched",
          `· would drop ${rel("fuel_prices", 45)} (dump recorded)`,
          `· would drop ${rel("fuel_prices", 44)} (dump recorded)`,
          `· would drop ${rel("fuel_prices", 41)} (dump recorded)`,
          `· would drop ${rel("transit_delays", 9)} (no archive)`,
          `· would drop ${rel("transit_delays", 8)} (no archive)`,
          `· would drop ${rel("transit_delays", 6)} (no archive)`,
          `· would drop ${rel("transit_delays", 7)} (detached leftover)`,
        ]);
        expect(r.lines.at(-1)).toMatch(/^✓ partitions retain: 7 to drop, 0 failed, \d+ kept, 1 held \(dry run: nothing changed; --apply to act\)$/);
      } finally {
        await endPool(s.pool, () => s.close());
      }
      for (const [tb, n] of [["fuel_prices", 41], ["transit_delays", 6], ["transit_delays", 7], ["transit_delays", 8], ["transit_delays", 9]] as const) expect(await exists(rel(tb, n))).toBe(true);
    });

    it("an apply drops each day past its window, finalizing the pending detach first; a drop that cannot take its lock fails alone (exit 1) and the next apply finishes it", async () => {
      const blocker = await t.pool.connect();
      try {
        await blocker.query("begin");
        await blocker.query(`lock table public.${rel("fuel_prices", 41)} in access share mode`);
        const r = await retain(t.pool, { apply: true, detachWaitMs: 2_000 });
        expect(r.exitCode).toBe(1);
        expect(r.lines.filter((l) => /^[✓✗⚠] (dropped|fuel)/.test(l) || l.startsWith(`✗ ${rel("fuel_prices", 41)}`))).toEqual([
          `⚠ ${rel("fuel_prices", 42)}: HELD — partition_archives says it was dropped and no restore since explains why it exists; not dropped until somebody has looked`,
          `✓ dropped ${rel("fuel_prices", 45)} (dump recorded)`,
          `⚠ ${rel("fuel_prices", 44)}: HELD — it holds 2 row(s), its recorded dump 1; not dropped until somebody has looked`,
          expect.stringMatching(new RegExp(`^✗ ${rel("fuel_prices", 41)}: canceling statement due to lock timeout`)) as unknown,
          `✓ dropped ${rel("transit_delays", 9)} (no archive)`,
          `✓ dropped ${rel("transit_delays", 8)} (no archive)`,
          `✓ dropped ${rel("transit_delays", 6)} (no archive)`,
          `✓ dropped ${rel("transit_delays", 7)} (detached leftover)`,
        ]);
        expect(r.lines.at(-1)).toMatch(/^✗ partitions retain: 5 dropped, 1 failed, \d+ kept, 2 held$/);
      } finally {
        await blocker.query("rollback");
        blocker.release();
      }
      expect(await exists(rel("fuel_prices", 41))).toBe(true);
      const again = await retain(t.pool, { apply: true });
      expect(again.exitCode).toBe(4);
      expect(again.lines.filter((l) => l.startsWith("✓ dropped"))).toEqual([`✓ dropped ${rel("fuel_prices", 41)} (dump recorded)`]);
      for (const [tb, n] of [["fuel_prices", 41], ["transit_delays", 6], ["transit_delays", 7], ["transit_delays", 8], ["transit_delays", 9]] as const) expect(await exists(rel(tb, n))).toBe(false);
      for (const [tb, n] of [["fuel_prices", 40], ["fuel_prices", 42], ["fuel_prices", 43], ["fuel_prices", 44], ["transit_delays", 2], ["transit_delays", 3]] as const) expect(await exists(rel(tb, n)), rel(tb, n)).toBe(true);
      expect(await exists(rel("fuel_prices", 45))).toBe(false);
      // The held day is still a partition of its table, both rows in place, and held again by the second apply.
      expect(await one(t.pool, `select count(*)::int as n from public.fuel_prices where observed_at >= '${d(44)}' and observed_at < '${d(43)}'`)).toEqual({ n: 2 });
      expect(again.lines).toContain(`⚠ ${rel("fuel_prices", 44)}: HELD — it holds 2 row(s), its recorded dump 1; not dropped until somebody has looked`);
      expect(await exists("transit_delays_misc")).toBe(true);
      const stamped = await rows<{ day: string; dropped: boolean }>(t.pool, "select to_char(day, 'YYYY-MM-DD') as day, dropped_at > now() - interval '1 hour' as dropped from partition_archives order by day desc");
      expect(stamped).toEqual([
        { day: d(6), dropped: true },
        { day: d(7), dropped: true },
        { day: d(40 + 1), dropped: true },
        { day: d(42), dropped: false },
        { day: d(43), dropped: false },
        { day: d(44), dropped: null },
        { day: d(45), dropped: true },
      ]);
      // A day partition the maker keeps three days back, empty, is left; with a row it would go.
      expect(await one(t.pool, `select count(*)::int as n from public.${rel("transit_delays", 2)}`)).toEqual({ n: 0 });
    });

    it("refuses a run over nothing: partition_retention reaching no day partition is exit 1, not a pass", async () => {
      await t.pool.query("delete from partition_retention where schema_name = 'public'");
      const r = await retain(t.pool, { apply: false });
      expect(r).toEqual({ ok: false, exitCode: 1, lines: ["✗ partition_retention reaches no day partition of schema public — a retain over nothing is not a pass"] });
    });
  });

  describe("4 — reclaim", () => {
    const noon = new Date(`${utcDay(new Date())}T12:00:00Z`);
    const filenodes = async (): Promise<number[]> => (await rows<{ n: number }>(t.pool, "select relfilenode::int as n from pg_class where oid in ('public.stop_times'::regclass, 'public.trips'::regclass) order by relname")).map((x) => x.n);

    it("is refused while retired trips wait for their stop times, and while another session holds the GTFS write lock; nothing is rewritten", async () => {
      const before = await filenodes();
      await t.pool.query("insert into gtfs_stale_trips (gtfs_feed_key, trip_id, retired_run_id) values (1, 'old', 1)");
      const s = new DatabaseService({ config: loadConfig({ DATABASE_URL: t.url }, "cli"), log: quiet });
      try {
        const r = await s.reclaim("cli", false);
        expect(r.exitCode).toBe(2);
        expect(r.lines).toContain("    - the prune is not done: 1 retired trip(s) still have stop times to delete");
      } finally {
        await endPool(s.pool, () => s.close());
      }
      await t.pool.query("delete from gtfs_stale_trips");
      const holder = await t.pool.connect();
      try {
        await holder.query("select pg_advisory_lock($1)", [GTFS_WRITE_LOCK]);
        expect(await reclaim(t.pool, { dryRun: true, now: noon })).toEqual({
          ok: false,
          exitCode: 2,
          lines: ["✗ reclaim REFUSED — nothing was rewritten:", "    - the GTFS write lock is held (a load or the catch-up prune)"],
        });
      } finally {
        holder.release(true);
      }
      expect(await filenodes()).toEqual(before);
    });

    it("a dry run with every precondition holding rewrites nothing; a run rewrites stop_times and trips", async () => {
      const before = await filenodes();
      expect(await reclaim(t.pool, { dryRun: true, now: noon })).toEqual({ ok: true, exitCode: 0, lines: ["✓ reclaim: every precondition the database answers holds (dry run: nothing rewritten)"] });
      expect(await filenodes()).toEqual(before);
      const r = await reclaim(t.pool, { dryRun: false, now: noon });
      expect(r.exitCode).toBe(0);
      expect(r.lines.map((l) => l.replace(/\(\d+ ms\)$/, "(N ms)"))).toEqual(["✓ vacuum (full, analyze) public.stop_times (N ms)", "✓ vacuum (full, analyze) public.trips (N ms)"]);
      const after = await filenodes();
      expect(after[0]).not.toBe(before[0]);
      expect(after[1]).not.toBe(before[1]);
    });

    it("gives up after its 5 s lock timeout rather than queue every reader behind it (exit 1)", async () => {
      const reader = await t.pool.connect();
      try {
        await reader.query("begin");
        await reader.query("lock table public.stop_times in access share mode");
        const t0 = Date.now();
        const r = await reclaim(t.pool, { dryRun: false, now: noon });
        expect(Date.now() - t0).toBeLessThan(15_000);
        expect(r).toMatchObject({ ok: false, exitCode: 1 });
        expect(r.lines).toEqual(["✗ reclaim failed: canceling statement due to lock timeout"]);
      } finally {
        await reader.query("rollback");
        reader.release();
      }
    });
  });
});
