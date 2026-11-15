/**
 * The joined and aggregating views (#32), by behaviour: each case of
 * test/views-complex.cases.ts plants a small world in a rolled-back
 * transaction (CHECKs dropped, session_replication_role = replica, so only
 * the view is under test), refreshes the materialized views it names and
 * compares the view's answer. Every row the answer leaves out fails exactly
 * one condition of the view, which scripts/mutants-schema-behaviour.ts breaks.
 *
 *   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/empty npm run test:db
 */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DomainDb } from "./domain-db.js";
import { rows, requireDb, url } from "./schema-db.js";
import { insertRow } from "./seed-fill.js";
import { COMPLEX_CASES } from "./views-complex.cases.js";

requireDb("the joined views");

describe.skipIf(url === undefined)("the joined and aggregating views", () => {
  const t = new DomainDb(url ?? "postgresql://x@127.0.0.1/x", "views_cx");

  beforeAll(async () => {
    await t.make([]);
  }, 900_000);

  afterAll(async () => {
    await t.drop();
  });

  const check = async (view: string): Promise<void> => {
    const k = COMPLEX_CASES.find((x) => x.view === view);
    if (k === undefined) throw new Error(`no case for ${view}`);
    await t.planted(async (c) => {
      for (const sql of k.before ?? []) await c.query(sql);
      for (const table of new Set(k.seed.map(([tb]) => tb))) {
        for (const ck of await rows<{ n: string }>(c, "select conname as n from pg_constraint where conrelid = $1::regclass and contype = 'c'", [table])) {
          await c.query(`alter table ${table} drop constraint "${ck.n}"`);
        }
      }
      await c.query("set local session_replication_role = replica");
      for (const [i, [table, set]] of k.seed.entries()) await insertRow(c, table, set, 1 + i, "1");
      for (const mv of k.refresh ?? []) await c.query(`refresh materialized view ${mv}`);
      expect(await rows(c, k.query)).toEqual(k.expect);
    });
  };

  it("public.city_traffic_now_live: a segment with a status, at its feed's pull of the same instant", () => check("public.city_traffic_now_live"));
  it("public.fuel_feed_health: the Tankerkönig runs of the day and the hour, the watched stations' newest price and coverage", () => check("public.fuel_feed_health"));
  it("public.fuel_station_board_live: one row per live station, its positive open prices per product", () => check("public.fuel_station_board_live"));
  it("public.fuel_station_watch_due: the active stations whose backoff has passed, by priority, the never polled first", () => check("public.fuel_station_watch_due"));
  it("public.gtfs_route_kreise: the Kreise each live route stops in", () => check("public.gtfs_route_kreise"));
  it("public.gtfs_untimed_trips: the trips of more than one stop whose times never move", () => check("public.gtfs_untimed_trips"));
  it("public.lorry_reads_live: each lorry feed's newest successful read", () => check("public.lorry_reads_live"));
  it("public.los_lane_now_live: an open, public lane of an open, public main-carriageway site with a road and a place", () => check("public.los_lane_now_live"));
  it("public.los_now_live: an open, public main-carriageway site with a road and a place, and a public state", () => check("public.los_now_live"));
  it("public.motorway_register_live: every motorway number, once, from the German TMC table and the Autobahn API", () => check("public.motorway_register_live"));
  it("public.osm_street_tiles: the open streets from class 2 in one-kilometre tiles per class", () => check("public.osm_street_tiles"));
  it("public.osm_street_tiles_lo: the open simplified streets of classes 2 to 4 in ten-kilometre tiles", () => check("public.osm_street_tiles_lo"));
  it("public.service_alert_lands_live: per Land, the public alerts placed by stop or route and the newest sighting", () => check("public.service_alert_lands_live"));
  it("public.station_index_live: each open station with its newest slug, the first of one instant", () => check("public.station_index_live"));
  it("public.traffic_count_now_live: every open site with its vehicle and heavy counts, if any", () => check("public.traffic_count_now_live"));
  it("public.traffic_count_profiles_live: the open sites' profiles of their feed's newest month", () => check("public.traffic_count_profiles_live"));
  it("public.transit_departures_odbl_live: the boardable departures of open trips on the service days of the window, with the trip update at the stop", () => check("public.transit_departures_odbl_live"));
  it("public.transit_odbl_service_days_live: four service days in Berlin's and every open agency's zone", () => check("public.transit_odbl_service_days_live"));
  it("public.transit_punctuality_area_live: the last half hour of DELFI delays per nation, Land, city and Kreis, untimed trips apart", () => check("public.transit_punctuality_area_live"));
  it("public.transit_punctuality_live: per Land, the trips with a DELFI delay in the last half hour and the late ones", () => check("public.transit_punctuality_live"));
  it("public.transit_station_live: the eight main stations, their stops and platforms and the last half hour of their delays", () => check("public.transit_station_live"));
  it("public.transit_stop_modes: per stop family, its modes and lines from live trips, routes and stops", () => check("public.transit_stop_modes"));
  it("public.weather_warnings_area_live: every live warning with its English text, when there is one", () => check("public.weather_warnings_area_live"));

  it("every case has its literal test", () => {
    const src = readFileSync(new URL(import.meta.url), "utf8");
    expect(COMPLEX_CASES.filter((k) => !src.includes(`it("${k.view}: `) || !src.includes(`check("${k.view}")`)).map((k) => k.view)).toEqual([]);
  });
});
