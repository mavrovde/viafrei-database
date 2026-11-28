/**
 * The migration-body replays of the migrations before the baseline (#31 item
 * 6): each is now a test of what the migration ESTABLISHED, run
 * against the baseline schema this repository ships — never the old body
 * replayed as a fixture. One rolled-back transaction per case.
 *
 *   0064  the DATEX II confidentiality column, its _live views, and
 *         road_events_current withholding a marked row
 *   0109  transit_stop_modes (one row per stop family, its modes), the eight-
 *         hour SIRI ET window, the open and publishable alerts
 *   0158  a line's timetable routes place an alert by their Kreise
 *   0201  E5 (no copy: the mobilithek.<k>.paused key still admitted beside
 *         source.<k>.*), run-now and its guard, the source bounds, the latch
 *   0235  vf_ledger_mask equals the TypeScript mask on the shared fixture
 *   0238  the GeoNames English-name index and its predicate, used
 *   0263  the request-limit keys are out of runtime_config
 *   0274  db_station_boards, its readers, and its shares
 *   0285  every caller a bounded share; the owed pair
 *   0286  warming switched off with a cap of 0
 *
 * The one-off data steps (0064's backfill, 0158's re-placement, 0201's latch
 * seed, 0235's two UPDATEs, 0285's fit_shares sweep) changed rows that existed
 * on prod at the time; a database built from the baseline holds none, so what
 * is asserted is the rule those rows now obey.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DomainDb } from "./domain-db.js";
import { REPO } from "./helpers.js";

const db = new DomainDb(process.env["TEST_DATABASE_URL"] ?? "", "replays");

beforeAll(async () => {
  await db.make([]);
}, 600_000);
afterAll(async () => {
  await db.drop();
});

type Refused = { code: string | undefined; detail: string | undefined; message: string } | null;

/** One case in a transaction that is always rolled back, the control audit's actor and reason set. */
async function tx(fn: (c: pg.PoolClient) => Promise<void>): Promise<void> {
  const c = await db.pool.connect();
  try {
    await c.query("begin");
    await c.query("set local viafrei.actor = 'test'");
    await c.query("set local viafrei.reason = 'replays.db.test.ts'");
    await fn(c);
  } finally {
    await c.query("rollback");
    c.release();
  }
}

/** Runs the statements under a savepoint with every deferred check fired at the end; the refusal, or null. */
async function attempt(c: pg.PoolClient, ...stmts: (string | [string, unknown[]])[]): Promise<Refused> {
  await c.query("savepoint a");
  try {
    for (const s of stmts) {
      if (typeof s === "string") await c.query(s);
      else await c.query(s[0], s[1]);
    }
    await c.query("set constraints all immediate");
    await c.query("release savepoint a");
    await c.query("set constraints all deferred");
    return null;
  } catch (e) {
    await c.query("rollback to savepoint a");
    await c.query("set constraints all deferred");
    const x = e as { code?: string; detail?: string; message: string };
    return { code: x.code, detail: x.detail, message: x.message };
  }
}

const one = async <T>(c: pg.PoolClient, sql: string, params: unknown[] = []): Promise<T> => (await c.query(sql, params)).rows[0] as T;
const col = async (c: pg.PoolClient, sql: string, params: unknown[] = []): Promise<unknown[]> =>
  (await c.query<{ v: unknown }>(sql, params)).rows.map((r) => r.v);

describe("0064: the DATEX II confidentiality marking", () => {
  const TABLES = [
    "charging_point_status", "charging_point_status_newest", "charging_points", "charging_sites", "delfi_service_alerts", "los_lane_sites", "los_lane_state", "los_sites", "los_state", "los_ticks",
    "parking_facilities", "parking_facilities_bysa", "parking_facilities_odbl", "parking_facilities_sid", "parking_occupancy", "parking_occupancy_odbl", "parking_occupancy_sid", "road_events",
  ];
  const LIVE = [
    "charging_point_status_live", "charging_point_status_newest_live", "charging_points_live", "charging_sites_live", "parking_facilities_bysa_live", "parking_facilities_live", "parking_facilities_odbl_live",
    "parking_facilities_sid_live", "parking_occupancy_live", "parking_occupancy_odbl_live", "parking_occupancy_sid_live", "road_events_live",
  ];
  const carrying = (kinds: string): string =>
    `select c.relname as v from pg_attribute a join pg_class c on c.oid = a.attrelid
      where c.relnamespace = 'public'::regnamespace and a.attname = 'confidentiality' and not a.attisdropped
        and c.relkind = any('${kinds}'::"char"[]) and not c.relispartition order by 1`;

  it("exactly the tables main's CONFIDENTIALITY_TABLES named carry a text confidentiality column, so no reader misses one", async () => {
    await tx(async (c) => {
      expect(await col(c, carrying("{r,p}"))).toEqual(TABLES);
      const types = await col(c, "select distinct format_type(atttypid, atttypmod) as v from pg_attribute where attname = 'confidentiality' and attrelid = any($1::regclass[])", [TABLES]);
      expect(types).toEqual(["text"]);
    });
  });

  it("every _live view over them exposes the column, so a gated read through the view can see it", async () => {
    await tx(async (c) => {
      expect(await col(c, carrying("{v}").replace("order by 1", "and c.relname like '%\\_live' order by 1"))).toEqual(LIVE);
    });
  });

  it("feed_runs.reader_epoch is a nullable smallint (the reader generation that wrote the row)", async () => {
    await tx(async (c) => {
      expect(await one(c, "select format_type(atttypid, atttypmod) as t, attnotnull as nn from pg_attribute where attrelid = 'feed_runs'::regclass and attname = 'reader_epoch'")).toEqual({ t: "smallint", nn: false });
    });
  });

  it("road_events_current withholds a row marked anything but noRestriction, and keeps an absent and a free one", async () => {
    await tx(async (c) => {
      for (const [id, mark] of [["zz-absent", null], ["zz-free", "noRestriction"], ["zz-internal", "internalUse"], ["zz-case", "NoRestriction"]] as const) {
        await c.query(
          "insert into road_events (feed_key, source_id, publication_id, version, payload, confidentiality, overall_start) values ('zz_464', 'zz', $1, 1, '{}'::jsonb, $2, now() - interval '1 hour')",
          [id, mark],
        );
      }
      const all = await col(c, "select publication_id as v from road_events_live where feed_key = 'zz_464' order by 1");
      expect(all).toEqual(["zz-absent", "zz-case", "zz-free", "zz-internal"]);
      expect(await col(c, "select publication_id as v from road_events_current where feed_key = 'zz_464' order by 1")).toEqual(["zz-absent", "zz-free"]);
    });
  });
});

describe("0109: the stations-near relations of the digest", () => {
  async function family(c: pg.PoolClient): Promise<void> {
    const at = "st_setsrid(st_makepoint(13.0, 52.0), 4326)::geography";
    await c.query(`insert into stops (gtfs_feed_key, id, name, geom, parent_id) values
      (1, 'zz:P', 'Zz Hbf', ${at}, null),
      (1, 'zz:P:1', 'Zz Hbf Gleis 1', ${at}, 'zz:P'),
      (1, 'zz:P:2', 'Zz Hbf Gleis 2', ${at}, 'zz:P'),
      (1, 'zz:P:3', 'Zz Hbf Bus', ${at}, 'zz:P'),
      (1, 'zz:O', 'Zz Other', ${at}, null)`);
    await c.query(`insert into routes (gtfs_feed_key, id, route_type, short_name) values
      (1, 'zz-s1', 109, 'S1'), (1, 'zz-re', 2, 'RE1'), (1, 'zz-bus', 3, ' 42 '), (1, 'zz-bus2', 714, ''), (1, 'zz-x', 1700, 'X')`);
    await c.query(`insert into trips (gtfs_feed_key, id, route_id, service_id) values
      (1, 'zz-t1', 'zz-s1', 's'), (1, 'zz-t2', 'zz-re', 's'), (1, 'zz-t3', 'zz-bus', 's'), (1, 'zz-t4', 'zz-bus2', 's'), (1, 'zz-t5', 'zz-x', 's')`);
    await c.query(`insert into stop_times (gtfs_feed_key, trip_id, stop_id, stop_sequence) values
      (1, 'zz-t1', 'zz:P:1', 0), (1, 'zz-t2', 'zz:P:2', 0), (1, 'zz-t3', 'zz:P:3', 0), (1, 'zz-t4', 'zz:P:3', 1), (1, 'zz-t5', 'zz:O', 0)`);
    await c.query("refresh materialized view transit_stop_modes");
  }

  it("transit_stop_modes: one row per family under the parent's name, sbahn only for 109, the lines trimmed and sorted; a family of 'other' only is left out", async () => {
    await tx(async (c) => {
      await family(c);
      const r = await c.query("select root_id, name, modes, lines, stop_ids from transit_stop_modes where root_id like 'zz:%' order by 1");
      expect(r.rows).toEqual([{ root_id: "zz:P", name: "Zz Hbf", modes: ["bus", "rail", "sbahn"], lines: ["42", "RE1", "S1"], stop_ids: ["zz:P:1", "zz:P:2", "zz:P:3"] }]);
    });
  });

  it("transit_stop_modes is keyed (gtfs_feed_key, root_id) and searchable by its point", async () => {
    await tx(async (c) => {
      const idx = await col(c, "select pg_get_indexdef(indexrelid) as v from pg_index where indrelid = 'transit_stop_modes'::regclass order by 1");
      expect(idx).toEqual([
        "CREATE INDEX transit_stop_modes_geom ON public.transit_stop_modes USING gist (geom)",
        "CREATE UNIQUE INDEX transit_stop_modes_key ON public.transit_stop_modes USING btree (gtfs_feed_key, root_id)",
      ]);
    });
  });

  it("delfi_siri_et_calls_live holds the last eight hours and nothing later than now", async () => {
    await tx(async (c) => {
      await c.query("select ensure_daily_partitions(1)");
      for (const [ref, ago] of [["zz-1h", "1 hour"], ["zz-7h", "7 hours 50 minutes"], ["zz-9h", "8 hours 10 minutes"], ["zz-ahead", "-10 minutes"]] as const) {
        await c.query("insert into delfi_siri_et_calls (observed_at, service_day, journey_ref, stop_ref, visit) values (now() - $2::interval, current_date, $1, 'zz-stop', 1)", [ref, ago]);
      }
      expect(await col(c, "select journey_ref as v from delfi_siri_et_calls_live where stop_ref = 'zz-stop' order by 1")).toEqual(["zz-1h", "zz-7h"]);
    });
  });

  it("delfi_service_alerts_live holds the open, publishable alerts only", async () => {
    await tx(async (c) => {
      for (const [id, mark, closed] of [["zz-open", null, false], ["zz-free", "noRestriction", false], ["zz-closed", null, true], ["zz-marked", "internalUse", false]] as const) {
        await c.query(
          "insert into delfi_service_alerts (source_id, source_feed, alert_id, header, dedupe_key, content_hash, confidentiality, closed_at) values ('delfi_rt_sa', 'zz', $1, 'h', $1, 'x', $2, case when $3 then now() end)",
          [id, mark, closed],
        );
      }
      expect(await col(c, "select alert_id as v from delfi_service_alerts_live where source_feed = 'zz' order by 1")).toEqual(["zz-free", "zz-open"]);
    });
  });

  it("the digest's role reads the stop families and the alerts; the SIRI ET view 0109 granted it was taken back by 0258", async () => {
    await tx(async (c) => {
      expect(await col(c, "select has_table_privilege('viafrei_digest', r, 'select') as v from unnest(array['transit_stop_modes', 'delfi_siri_et_calls_live', 'delfi_service_alerts_live']) as u(r)")).toEqual([true, false, true]);
    });
  });
});

describe("0158: an alert naming a LINE is placed by the Kreise of that line's timetable routes", () => {
  it("gtfs_route_kreise carries each route's Kreise; a line id is the route id up to its last colon; a route placement is admitted", async () => {
    await tx(async (c) => {
      await c.query("insert into trips (gtfs_feed_key, id, route_id, service_id) values (1, 'ZZ838-A', 'de:vmv:rsag-2:_0', 's'), (1, 'ZZ838-B', 'de:vmv:rsag-6:_3', 's')");
      await c.query("insert into stop_times (gtfs_feed_key, trip_id, stop_id, stop_sequence) values (1, 'ZZ838-A', 'de:13003:7001:0:1', 0), (1, 'ZZ838-B', 'de:13003:7002:0:1', 0)");
      await c.query("refresh materialized view gtfs_route_kreise");
      // 0158's join: a timetable route under a line id `a:b:c:` (three or more parts, trailing colon) by route_id with its last part cut.
      const placed = await c.query(
        `select l.id as line, array_agg(distinct k order by k) as kreise
           from unnest(array['de:vmv:rsag-2:', 'de:vmv:rsag-6:', '85:823:33', 'bvb:01003:']) as l(id)
           join gtfs_route_kreise t on t.gtfs_feed_key = 1 and (t.route_id = l.id or (l.id ~ '^[^:]+(:[^:]+){2,}:$' and regexp_replace(t.route_id, '[^:]*$', '') = l.id))
           cross join lateral unnest(t.kreise) as k
          group by l.id order by 1`,
      );
      expect(placed.rows).toEqual([{ line: "de:vmv:rsag-2:", kreise: ["13003"] }, { line: "de:vmv:rsag-6:", kreise: ["13003"] }]);
      expect(
        await attempt(c, "insert into delfi_service_alerts (source_id, source_feed, alert_id, header, dedupe_key, content_hash, route_ids, kreise, lands, placed_by) values ('delfi_siri_sx', 'zz', 'zz-1', 'h', 'd', 'x', '{de:vmv:rsag-2:}', '{13003}', '{13}', 'route')"),
      ).toBeNull();
      expect((await attempt(c, "insert into delfi_service_alerts (source_id, source_feed, alert_id, header, dedupe_key, content_hash, placed_by) values ('delfi_siri_sx', 'zz', 'zz-2', 'h', 'd', 'x', 'line')"))?.code).toBe("23514");
      expect(await one(c, "select placed_by, kreise, lands from delfi_service_alerts where alert_id = 'zz-1'")).toEqual({ placed_by: "route", kreise: ["13003"], lands: ["13"] });
      expect(await one(c, "select column_default as d from information_schema.columns where table_name = 'delfi_service_alerts' and column_name = 'placed_by'")).toEqual({ d: "'none'::text" });
    });
  });
});

describe("0201: the engine's schedule, run-now and the source bounds", () => {
  const schedule = (key: string, floor: number, declared: number, lastRequest: string | null = null): [string, unknown[]] => [
    "insert into source_schedule (source_key, host, declared_cadence_s, granted_cadence_s, floor_s, last_request_at) values ($1, 'ingest-dwd', $2, $2, $3, $4)",
    [key, declared, floor, lastRequest],
  ];
  const config = (key: string, value: string): [string, unknown[]] => ["insert into runtime_config (key, value, changed_by, reason) values ($1, $2, 'test', 'replays')", [key, value]];
  const runNow = (target: string, at = "now()"): [string, unknown[]] => [`insert into ops_requests (action, target, requested_by, requested_at) values ('run-now', $1, 'test', ${at})`, [target]];

  it("E5: nothing is copied — a mobilithek.<k>.paused row is still admitted beside source.<k>.paused, and runtime_config holds no row of either at the baseline", async () => {
    await tx(async (c) => {
      expect(await one(c, "select count(*)::int as n from runtime_config where key like 'source.%' or key like 'mobilithek.%'")).toEqual({ n: 0 });
      expect(await attempt(c, schedule("zz_e5", 60, 300))).toBeNull();
      expect(await attempt(c, config("mobilithek.zz_e5.paused", "true"))).toBeNull();
      expect(await attempt(c, config("source.zz_e5.paused", "false"))).toBeNull();
      expect(await col(c, "select key || '=' || value as v from runtime_config where key like '%zz_e5%' order by 1")).toEqual(["mobilithek.zz_e5.paused=true", "source.zz_e5.paused=false"]);
    });
  });

  it("source.<k>.*: an unknown source refused; an interval at the floor (catalogue, schedule or 60 s) admitted, below refused; four times the declared admitted, above refused", async () => {
    await tx(async (c) => {
      expect((await attempt(c, config("source.zz_none.paused", "true")))?.detail).toBe("unknown-source");
      expect(await attempt(c, schedule("zz_iv", 120, 600))).toBeNull();
      expect(await attempt(c, config("source.zz_iv.interval_s", "120"))).toBeNull();
      await c.query("delete from runtime_config where key = 'source.zz_iv.interval_s'");
      expect((await attempt(c, config("source.zz_iv.interval_s", "119")))?.detail).toBe("below-floor");
      expect(await attempt(c, config("source.zz_iv.interval_s", "2400"))).toBeNull();
      expect((await attempt(c, ["update runtime_config set value = '2401' where key = 'source.zz_iv.interval_s'", []]))?.detail).toBe("above-stretch");
      expect(await attempt(c, schedule("zz_iv0", 0, 120))).toBeNull();
      expect((await attempt(c, config("source.zz_iv0.interval_s", "59")))?.detail).toBe("below-floor");
      expect((await attempt(c, config("source.zz_iv.paused", "maybe")))?.code).toBe("23514");
    });
  });

  it("run-now: unknown-source, below-floor from the last request, already-pending; a restart keeps its five-minute rule and run-now neither trips nor counts against it", async () => {
    await tx(async (c) => {
      expect((await attempt(c, runNow("zz_none")))?.detail).toBe("unknown-source");
      expect(await attempt(c, schedule("zz_floor", 600, 600, new Date(Date.now() - 5 * 60_000).toISOString()))).toBeNull();
      expect((await attempt(c, runNow("zz_floor")))?.detail).toBe("below-floor");
      expect(await attempt(c, schedule("zz_once", 60, 600))).toBeNull();
      expect(await attempt(c, runNow("zz_once"))).toBeNull();
      expect((await attempt(c, runNow("zz_once")))?.detail).toBe("already-pending");
      expect((await attempt(c, ["insert into ops_requests (action, target, requested_by) values ('pause', 'zz_once', 'test')", []]))?.code).toBe("23514");
      expect((await attempt(c, ["insert into ops_requests (action, target, requested_by) values ('restart', 'zz_once', 'test')", []]))?.code).toBe("23514");
      expect(await attempt(c, schedule("status", 60, 600))).toBeNull();
      expect(await attempt(c, runNow("status"))).toBeNull();
      expect(await attempt(c, ["insert into ops_requests (action, target, requested_by) values ('restart', 'status', 'test')", []])).toBeNull();
      expect((await attempt(c, ["insert into ops_requests (action, target, requested_by) values ('restart', 'status', 'test')", []]))?.message).toMatch(/less than five minutes ago/);
    });
  });

  it("ops_audit admits run-now, pause and resume beside the older actions, and nothing else", async () => {
    await tx(async (c) => {
      for (const a of ["login", "restart", "config", "run-now", "pause", "resume"]) {
        expect(await attempt(c, ["insert into ops_audit (actor, action, target, result) values ('test', $1, 'zz', 'ok')", [a]]), a).toBeNull();
      }
      expect((await attempt(c, ["insert into ops_audit (actor, action, target, result) values ('test', 'delete', 'zz', 'ok')", []]))?.code).toBe("23514");
    });
  });

  it("the stray latch the seed carried over: parkapi_bw only, one open at most beside closed ones, never cleared before tripped, a reason of 200 at most", async () => {
    await tx(async (c) => {
      const latch = (key: string, tripped: string, cleared: string | null, reason = "r"): [string, unknown[]] => [
        "insert into parkapi_stray_latch (feed_key, tripped_at, reason, cleared_at) values ($1, $2, $3, $4)",
        [key, tripped, reason, cleared],
      ];
      expect(await one(c, "select count(*)::int as n from parkapi_stray_latch")).toEqual({ n: 0 });
      expect(await attempt(c, latch("parkapi_bw", "2026-10-20T10:00:00Z", "2026-10-21T10:00:00Z"))).toBeNull();
      expect(await attempt(c, latch("parkapi_bw", "2026-10-22T10:00:00Z", null, "x".repeat(200)))).toBeNull();
      expect((await attempt(c, latch("parkapi_bw", "2026-10-23T10:00:00Z", null)))?.code).toBe("23505");
      expect((await attempt(c, latch("parkapi_bw", "2026-10-23T10:00:00Z", "2026-10-22T10:00:00Z")))?.code).toBe("23514");
      expect((await attempt(c, latch("parkapi_other", "2026-10-23T10:00:00Z", "2026-10-24T10:00:00Z")))?.code).toBe("23514");
      expect((await attempt(c, latch("parkapi_bw", "2026-10-23T10:00:00Z", "2026-10-24T10:00:00Z", "x".repeat(201))))?.code).toBe("23514");
    });
  });

  it("viafrei_ops reads source_schedule and source_hosts and writes neither", async () => {
    await tx(async (c) => {
      const r = await col(c, "select has_table_privilege('viafrei_ops', t, p) as v from unnest(array['source_schedule', 'source_hosts']) as t, unnest(array['select', 'insert', 'update', 'delete']) as p order by t, p");
      expect(r).toEqual([false, false, true, false, false, false, true, false]);
    });
  });
});

describe("0235: the ledger's address mask in SQL", () => {
  const FIXTURE = (JSON.parse(readFileSync(join(REPO, "test", "replays", "ledger-mask.json"), "utf8")) as { cases: { in: string; out: string }[] }).cases;

  it("reads its fixture: every shape, with at least one case the mask changes and one it leaves alone", () => {
    expect(FIXTURE.length).toBeGreaterThanOrEqual(10);
    expect(FIXTURE.some((x) => x.in !== x.out)).toBe(true);
    expect(FIXTURE.some((x) => x.in === x.out)).toBe(true);
  });

  it("vf_ledger_mask equals main's ledgerText on every case of the shared fixture, and keeps a null", async () => {
    await tx(async (c) => {
      const r = await c.query<{ masked: string }>("select vf_ledger_mask(t) as masked from unnest($1::text[]) with ordinality as u(t, i) order by i", [FIXTURE.map((x) => x.in)]);
      expect(r.rows.map((x) => x.masked)).toEqual(FIXTURE.map((x) => x.out));
      expect(await one(c, "select vf_ledger_mask(null) as m")).toEqual({ m: null });
    });
  });
});

describe("0238: a GeoNames town by its English name", () => {
  it("the partial index exists with exactly 0238's key and predicate, and a lookup of the town-exonym shape uses it", async () => {
    await tx(async (c) => {
      expect(await one(c, "select pg_get_indexdef('gazetteer_places_geonames_name_en'::regclass) as d, indisvalid as ok from pg_index where indexrelid = 'gazetteer_places_geonames_name_en'::regclass")).toEqual({
        d: "CREATE INDEX gazetteer_places_geonames_name_en ON public.gazetteer_places USING btree (lower(name_en)) WHERE ((closed_at IS NULL) AND (kind = 'city'::text) AND (source_id = 'geonames'::text) AND (name_en IS NOT NULL) AND (geom IS NOT NULL))",
        ok: true,
      });
      await c.query("set local enable_seqscan = off");
      const plan = (await c.query<{ "QUERY PLAN": string }>(
        "explain select id from gazetteer_places where lower(name_en) = 'cologne' and closed_at is null and kind = 'city' and source_id = 'geonames' and name_en is not null and geom is not null",
      )).rows.map((r) => r["QUERY PLAN"]).join("\n");
      expect(plan).toMatch(/gazetteer_places_geonames_name_en/);
    });
  });
});

describe("0263: the request-limit tunables live in control, not runtime_config", () => {
  it("fuel.key_spacing_s, fuel.warm_per_hour and budget.* are refused; the kept keys and ui.card_page_size (3..50) are admitted", async () => {
    await tx(async (c) => {
      const put = (k: string, v: string): Promise<Refused> => attempt(c, ["insert into runtime_config (key, value, changed_by, reason) values ($1, $2, 'test', 'replays')", [k, v]]);
      for (const k of ["fuel.key_spacing_s", "fuel.warm_per_hour", "budget.tankerkoenig.ceiling"]) expect((await put(k, "60"))?.code, k).toBe("23514");
      for (const [k, v] of [["tankerkoenig.interval_s", "300"], ["fuel.detail_every_s", "300"], ["ui.card_page_size", "3"], ["mobilithek.zz.interval_s", "60"]] as const) expect(await put(k, v), k).toBeNull();
      await c.query("delete from runtime_config where key = 'ui.card_page_size'");
      for (const v of ["2", "51"]) expect((await put("ui.card_page_size", v))?.code, v).toBe("23514");
      expect(await put("ui.card_page_size", "50")).toBeNull();
    });
  });
});

describe("0274/0285/0286: the callers' shares of a budget key", () => {
  async function key(c: pg.PoolClient, k: string, ceiling: number, shares: readonly (readonly [string, number, number])[]): Promise<Refused> {
    const stmts: [string, unknown[]][] = [["insert into control.budgets (budget_key, window_s, licence_max, licence_source, ceiling) values ($1, 60, $2, 'replays.db.test.ts', $2)", [k, ceiling]]];
    for (const [caller, floor, cap] of shares) {
      stmts.push(["insert into control.callers (caller, process, person, purpose) values ($1, 'worker', false, 'replays') on conflict do nothing", [caller]]);
      stmts.push(["insert into control.shares (budget_key, caller, floor, cap) values ($1, $2, $3, $4)", [k, caller, floor, cap]]);
    }
    return attempt(c, ...stmts);
  }

  it("0274's shape: db_timetables at 60 a minute, the tool's floor 29 (0285) beside the worker's cap of 30, is admitted; both db_station_boards readers may read it", async () => {
    await tx(async (c) => {
      expect(await key(c, "db_timetables", 60, [["mcp", 29, 59], ["worker", 1, 30]])).toBeNull();
      expect(await attempt(c, "select control.set_budget('db_timetables', 'worker', 'cap', 30, 'migration', 'the stored boards take at most half of DB''s minute')")).toBeNull();
      expect(await col(c, "select has_table_privilege(r, 'db_station_boards', 'select') as v from unnest(array['viafrei_digest', 'viafrei_mcp', 'viafrei_status']) as r")).toEqual([true, true, false]);
    });
  });

  it("0285's bound: a cap that takes the other callers' floors, a caller with no floor, floors over the ceiling and a cap over it are refused, each by name", async () => {
    await tx(async (c) => {
      expect((await key(c, "zz_takes", 60, [["mcp", 30, 60], ["worker", 1, 30]]))?.detail).toBe("cap-takes-floors");
      expect((await key(c, "zz_starved", 60, [["mcp", 30, 59], ["worker", 0, 30]]))?.detail).toBe("no-floor");
      expect((await key(c, "zz_floors", 60, [["mcp", 31, 31], ["worker", 30, 30]]))?.detail).toBe("floors-over-ceiling");
      expect((await key(c, "zz_one", 60, [["mcp", 1, 61]]))?.detail).toBe("cap-over-ceiling");
      // A caller switched off (cap 0) needs no floor; one caller alone may hold the whole key.
      expect(await key(c, "zz_off", 60, [["mcp", 30, 59], ["warm", 0, 0], ["worker", 1, 30]])).toBeNull();
      expect(await key(c, "zz_alone", 60, [["mcp", 0, 60]])).toBeNull();
    });
  });

  it("0285's owed pair: owed_by and owed_at together or not at all, owed_by a caller-shaped name", async () => {
    await tx(async (c) => {
      expect(await key(c, "zz_owed", 10, [["mcp", 1, 10]])).toBeNull();
      const owe = (by: string | null, at: string | null): Promise<Refused> =>
        attempt(c, ["insert into control.budget_state (budget_key, owed_by, owed_at) values ('zz_owed', $1, $2) on conflict (budget_key) do update set owed_by = excluded.owed_by, owed_at = excluded.owed_at", [by, at]]);
      expect(await owe("mcp", "2026-11-15T10:00:00Z")).toBeNull();
      expect(await owe(null, null)).toBeNull();
      expect((await owe("mcp", null))?.code).toBe("23514");
      expect((await owe(null, "2026-11-15T10:00:00Z"))?.code).toBe("23514");
      expect((await owe("Not A Caller", "2026-11-15T10:00:00Z"))?.code).toBe("23514");
    });
  });

  it("0286: warming is switched off on tankerkoenig with a cap of 0 through set_budget, and a cap of 0 asks for no floor", async () => {
    await tx(async (c) => {
      expect(await key(c, "tankerkoenig", 60, [["mcp", 1, 59], ["warm", 1, 10]])).toBeNull();
      expect(
        await attempt(c, "select control.set_budget('tankerkoenig', 'warm', 'cap', 0, 'migration', '0286: warming is not inside the Tankerkoenig terms')"),
      ).toBeNull();
      expect(await one(c, "select floor, cap from control.shares where budget_key = 'tankerkoenig' and caller = 'warm'")).toEqual({ floor: 0, cap: 0 });
      expect(await col(c, "select field || ':' || coalesce(after, '') as v from control.changes where budget_key = 'tankerkoenig' and caller = 'warm' and actor = 'migration' order by id")).toContain("cap:0");
    });
  });
});
