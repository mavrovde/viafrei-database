/**
 * The filter views (#32), table-driven from test/views-filter.cases.ts: for
 * each view a row the view must return and one row per condition it must not,
 * seeded into the base table in a rolled-back transaction. The base table's
 * CHECKs are dropped inside the transaction and session_replication_role is
 * replica, so a row needs only its NOT NULL columns — the view's predicate is
 * the one thing under test (the CHECKs and FKs have tests of their own).
 *
 *   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/empty npm run test:db
 */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { DomainDb } from "./domain-db.js";
import { rows, requireDb, url } from "./schema-db.js";
import { COLS, fill, type Col } from "./seed-fill.js";
import { VIEW_CASES, type ViewCase } from "./views-filter.cases.js";

requireDb("the filter views");

describe.skipIf(url === undefined)("the filter views", () => {
  const t = new DomainDb(url ?? "postgresql://x@127.0.0.1/x", "views");

  beforeAll(async () => {
    await t.make([]);
  }, 900_000);

  afterAll(async () => {
    await t.drop();
  });

  const seed = async (c: pg.ClientBase, k: ViewCase): Promise<{ tag: string; inTags: string[]; outTags: string[] }> => {
    if (k.setup !== undefined) await c.query(k.setup);
    const cols = await rows<Col>(c, COLS, [k.table]);
    const viewCols = new Set((await rows<{ name: string }>(c, COLS, [k.view])).map((x) => x.name));
    const shown = cols.filter((x) => viewCols.has(x.name) && x.generated === "" && x.identity === "");
    const tag =
      k.tag ??
      cols.filter((x) => x.pk !== null && viewCols.has(x.name)).sort((a, b) => (a.pk ?? 0) - (b.pk ?? 0))[0]?.name ??
      shown.find((x) => /^(text|integer|bigint)$/.test(x.type) && !(x.name in { ...k.base, ...Object.assign({}, ...k.out) }))?.name;
    if (tag === undefined) throw new Error(`${k.view}: no column tells the rows apart; name a tag`);
    const tagCol = cols.find((x) => x.name === tag);
    if (tagCol === undefined) throw new Error(`${k.view}: ${tag} is no column of ${k.table}`);
    for (const ck of await rows<{ n: string }>(c, "select conname as n from pg_constraint where conrelid = $1::regclass and contype = 'c'", [k.table])) {
      await c.query(`alter table ${k.table} drop constraint "${ck.n}"`);
    }
    await c.query("set local session_replication_role = replica");
    const variants = [{ set: {}, in: true }, ...k.out.map((o) => ({ set: o, in: false }))];
    const inTags: string[] = [];
    const outTags: string[] = [];
    for (const [i, v] of variants.entries()) {
      const n = 101 + i;
      const set: Record<string, string> = { ...k.base, ...v.set };
      const names: string[] = [];
      const values: string[] = [];
      for (const col of cols) {
        const given = set[col.name];
        if (col.generated !== "") {
          if (given !== undefined) throw new Error(`${k.table}.${col.name} is generated; set what it is generated from`);
          continue;
        }
        if (col.name === tag && given === undefined) {
          names.push(col.name);
          values.push(fill(col, n));
        } else if (given !== undefined) {
          names.push(col.name);
          values.push(given);
        } else if (col.notnull && !col.hasdef && col.identity === "") {
          names.push(col.name);
          values.push(fill(col, n));
        }
      }
      const overriding = tagCol.identity === "a" ? " overriding system value" : "";
      const r = await rows<{ tag: string }>(
        c,
        `insert into ${k.table} (${names.map((x) => `"${x}"`).join(", ")})${overriding} values (${values.join(", ")}) returning "${tag}"::text as tag`,
      );
      (v.in ? inTags : outTags).push(r[0]?.tag ?? "");
    }
    return { tag, inTags, outTags };
  };

  const check = async (view: string): Promise<void> => {
    const k = VIEW_CASES.find((x) => x.view === view);
    if (k === undefined) throw new Error(`${view}: no case in views-filter.cases.ts`);
    await t.planted(async (c) => {
      const { tag, inTags, outTags } = await seed(c, k);
      const seen = await rows<{ tag: string }>(c, `select "${tag}"::text as tag from ${k.view} where "${tag}"::text = any($1)`, [[...inTags, ...outTags]]);
      expect(seen.map((x) => x.tag).sort()).toEqual(inTags.sort());
    });
  };

  // one literal title per case, so the coverage manifest can name it
  it("every case has its own test here, and every test its case", () => {
    const named = [...readFileSync(new URL(import.meta.url), "utf8").matchAll(/check\("([^"]+)"\)\);/g)].map((m) => m[1]);
    expect([...named].sort()).toEqual(VIEW_CASES.map((x) => x.view).sort());
  });
  it("public.bfrk_stops_live: returns the row it is for and none it leaves out", () => check("public.bfrk_stops_live"));
  it("public.bw_detours_live: returns the row it is for and none it leaves out", () => check("public.bw_detours_live"));
  it("public.charging_points_live: returns the row it is for and none it leaves out", () => check("public.charging_points_live"));
  it("public.fuel_price_latest_live: returns the row it is for and none it leaves out", () => check("public.fuel_price_latest_live"));
  it("public.fuel_stations_live: returns the row it is for and none it leaves out", () => check("public.fuel_stations_live"));
  it("public.hh_cameras_live: returns the row it is for and none it leaves out", () => check("public.hh_cameras_live"));
  it("public.hydrogen_stations_live: returns the row it is for and none it leaves out", () => check("public.hydrogen_stations_live"));
  it("public.lez_zones_live: returns the row it is for and none it leaves out", () => check("public.lez_zones_live"));
  it("public.lorry_city_live: returns the row it is for and none it leaves out", () => check("public.lorry_city_live"));
  it("public.lorry_hb_live: returns the row it is for and none it leaves out", () => check("public.lorry_hb_live"));
  it("public.lorry_ivm_live: returns the row it is for and none it leaves out", () => check("public.lorry_ivm_live"));
  it("public.lorry_long_network_live: returns the row it is for and none it leaves out", () => check("public.lorry_long_network_live"));
  it("public.lorry_sevas_live: returns the row it is for and none it leaves out", () => check("public.lorry_sevas_live"));
  it("public.mvv_bus_load_live: returns the row it is for and none it leaves out", () => check("public.mvv_bus_load_live"));
  it("public.osm_addresses_live: returns the row it is for and none it leaves out", () => check("public.osm_addresses_live"));
  it("public.osm_pois_live: returns the row it is for and none it leaves out", () => check("public.osm_pois_live"));
  it("public.osm_speed_cameras_live: returns the row it is for and none it leaves out", () => check("public.osm_speed_cameras_live"));
  it("public.parking_facilities_bysa_live: returns the row it is for and none it leaves out", () => check("public.parking_facilities_bysa_live"));
  it("public.parking_facilities_live: returns the row it is for and none it leaves out", () => check("public.parking_facilities_live"));
  it("public.parking_facilities_odbl_live: returns the row it is for and none it leaves out", () => check("public.parking_facilities_odbl_live"));
  it("public.parking_forecast_profiles_live: returns the row it is for and none it leaves out", () => check("public.parking_forecast_profiles_live"));
  it("public.parking_sites_live: returns the row it is for and none it leaves out", () => check("public.parking_sites_live"));
  it("public.road_events_live: returns the row it is for and none it leaves out", () => check("public.road_events_live"));
  it("public.routes_live: returns the row it is for and none it leaves out", () => check("public.routes_live"));
  it("public.speed_enforcement_live: returns the row it is for and none it leaves out", () => check("public.speed_enforcement_live"));
  it("public.station_accessibility_live: returns the row it is for and none it leaves out", () => check("public.station_accessibility_live"));
  it("public.station_equipment_live: returns the row it is for and none it leaves out", () => check("public.station_equipment_live"));
  it("public.stop_times_live: returns the row it is for and none it leaves out", () => check("public.stop_times_live"));
  it("public.stops_live: returns the row it is for and none it leaves out", () => check("public.stops_live"));
  it("public.trips_live: returns the row it is for and none it leaves out", () => check("public.trips_live"));
  it("public.weather_warnings_en_live: returns the row it is for and none it leaves out", () => check("public.weather_warnings_en_live"));
  it("public.weather_warnings_live: returns the row it is for and none it leaves out", () => check("public.weather_warnings_live"));
  it("public.road_weather_stations_live: returns the row it is for and none it leaves out", () => check("public.road_weather_stations_live"));
  it("public.road_context_live: returns the row it is for and none it leaves out", () => check("public.road_context_live"));
  it("public.hh_roadworks_live: returns the row it is for and none it leaves out", () => check("public.hh_roadworks_live"));
  it("public.charging_sites_live: returns the row it is for and none it leaves out", () => check("public.charging_sites_live"));
  it("public.transit_stops_odbl_live: returns the row it is for and none it leaves out", () => check("public.transit_stops_odbl_live"));
  it("public.station_metro_osm_decided: returns the row it is for and none it leaves out", () => check("public.station_metro_osm_decided"));
  it("public.motorway_points_live: returns the row it is for and none it leaves out", () => check("public.motorway_points_live"));
  it("public.vbb_transit_delays_live: returns the row it is for and none it leaves out", () => check("public.vbb_transit_delays_live"));
  it("public.vbn_transit_delays_live: returns the row it is for and none it leaves out", () => check("public.vbn_transit_delays_live"));
  it("public.vrn_transit_delays_live: returns the row it is for and none it leaves out", () => check("public.vrn_transit_delays_live"));
  it("public.delfi_siri_et_calls_live: returns the row it is for and none it leaves out", () => check("public.delfi_siri_et_calls_live"));
  it("public.gbfs_station_status_live: returns the row it is for and none it leaves out", () => check("public.gbfs_station_status_live"));
  it("public.los_sites_live: returns the row it is for and none it leaves out", () => check("public.los_sites_live"));
  it("public.delfi_service_alerts_live: returns the row it is for and none it leaves out", () => check("public.delfi_service_alerts_live"));
  it("public.opendata_roadworks_live: returns the row it is for and none it leaves out", () => check("public.opendata_roadworks_live"));
  it("public.city_traffic_segments_live: returns the row it is for and none it leaves out", () => check("public.city_traffic_segments_live"));
  it("public.city_traffic_pulls_live: returns the row it is for and none it leaves out", () => check("public.city_traffic_pulls_live"));
  it("public.road_weather_forecast_live: returns the row it is for and none it leaves out", () => check("public.road_weather_forecast_live"));
  it("public.charging_feed_runs_live: returns the row it is for and none it leaves out", () => check("public.charging_feed_runs_live"));
  it("public.db_facilities_live: returns the row it is for and none it leaves out", () => check("public.db_facilities_live"));
  it("public.parking_occupancy_live: returns the row it is for and none it leaves out", () => check("public.parking_occupancy_live"));
  it("public.parking_occupancy_sid_live: returns the row it is for and none it leaves out", () => check("public.parking_occupancy_sid_live"));
  it("public.parking_occupancy_odbl_live: returns the row it is for and none it leaves out", () => check("public.parking_occupancy_odbl_live"));
  it("public.charging_point_status_live: returns the row it is for and none it leaves out", () => check("public.charging_point_status_live"));
  it("public.charging_point_status_newest_live: returns the row it is for and none it leaves out", () => check("public.charging_point_status_newest_live"));
  it("public.motorway_summary_live: returns the row it is for and none it leaves out", () => check("public.motorway_summary_live"));
  it("public.parking_facilities_sid_live: returns the row it is for and none it leaves out", () => check("public.parking_facilities_sid_live"));
  it("public.gbfs_stations_live: returns the row it is for and none it leaves out", () => check("public.gbfs_stations_live"));
  it("public.street_bays_live: returns the row it is for and none it leaves out", () => check("public.street_bays_live"));
  it("public.gbfs_vehicles_live: returns the row it is for and none it leaves out", () => check("public.gbfs_vehicles_live"));
  it("public.transit_delays_live: returns the row it is for and none it leaves out", () => check("public.transit_delays_live"));
  it("public.connect_transit_delays_live: returns the row it is for and none it leaves out", () => check("public.connect_transit_delays_live"));
  it("public.vbn_transit_delays: returns the row it is for and none it leaves out", () => check("public.vbn_transit_delays"));
});
