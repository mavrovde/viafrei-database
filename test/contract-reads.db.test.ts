/**
 * The contract 0.3 read additions of 0312 (#29): the views the API reads to
 * answer what the MCP server and the site answer today (hydrogen, speed
 * cameras, sharing, POIs, addresses, service alerts, punctuality, street
 * bays) and the columns appended to charge_point, fuel_station and
 * parking_facility, each read as api_reader over platform rows.
 */
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DomainDb } from "./domain-db.js";

const db = new DomainDb(process.env["TEST_DATABASE_URL"] ?? "", "reads");

const PT = (lon: number, lat: number): string => `st_setsrid(st_makepoint(${String(lon)}, ${String(lat)}), 4326)::geography`;

const SEED = [
  `insert into public.hydrogen_stations (id, source_feed, external_id, name, operator, geom, refill, opening, attribution_id) values
     (1, 'mobilithek_h2_stations', 'h1', 'H2 Stuttgart', 'H2 Mobility', ${PT(9.18, 48.78)}, '[{"solution":"700bar"}]', '{"text":"24/7"}', 'mobilithek_h2_stations'),
     (2, 'mobilithek_h2_stations', 'h2', 'H2 alt', 'H2 Mobility', ${PT(9.2, 48.8)}, '[{"solution":"350bar"}]', null, 'mobilithek_h2_stations')`,
  `update public.hydrogen_stations set closed_at = now() where id = 2`,
  `insert into public.osm_speed_cameras (osm_type, osm_id, enforces, geom, max_speed_kmh, source_id, land, extract_date, last_seen_at) values
     ('node', 11, 'speed', ${PT(9.18, 48.78)}, 50, 'osm_speed_cameras', 'baden-wuerttemberg', '2026-11-01', now())`,
  `insert into public.speed_enforcement (id, source_feed, source_publisher, external_id, attribution_id, kind, enforces, geom, ags, max_speed_kmh, valid_from) values
     (5, 'koeln_blitzer', 'Stadt Köln', 'k5', 'koeln_blitzer', 'mobile_announced', 'speed', null, '05315000', 50, '2026-11-17')`,
  `insert into public.hh_cameras (camera_id, location_label, geom, first_seen_at, last_seen_at, source_feed, source_publisher) values
     ('c1', 'Elbbrücken', st_setsrid(st_makepoint(10.03, 53.53), 4326), now(), now(), 'hh_verkehrskameras', 'Hamburg')`,
  `insert into public.gbfs_systems (system_id, publisher, name, license_id, admitted, licence_basis, refused_reason, licence_read_at, first_seen_at, last_seen_at, source_feed, source_publisher, status_seen_at) values
     ('nb-s', 'gbfs_nextbike', 'nextbike Stuttgart', 'CC0-1.0', true, 'stated', null, now(), now(), now(), 'gbfs_nextbike', 'gbfs_nextbike', now()),
     ('nb-x', 'gbfs_nextbike', 'refused', null, false, null, 'no licence', now(), now(), now(), 'gbfs_nextbike', 'gbfs_nextbike', now())`,
  `insert into public.gbfs_stations (system_id, station_id, name, capacity, geom, first_seen_at, last_seen_at, source_feed, source_publisher) values
     ('nb-s', 'st1', 'Hauptbahnhof', 12, ${PT(9.18, 48.78)}, now(), now(), 'gbfs_nextbike', 'gbfs_nextbike'),
     ('nb-x', 'st9', 'Refused', 5, ${PT(9.18, 48.78)}, now(), now(), 'gbfs_nextbike', 'gbfs_nextbike')`,
  `insert into public.gbfs_vehicles (system_id, seq, form_factor, propulsion, geom, observed_at, source_feed, source_publisher) values
     ('nb-s', 1, 'bicycle', 'electric_assist', ${PT(9.18, 48.78)}, now(), 'gbfs_nextbike', 'gbfs_nextbike')`,
  `insert into public.osm_pois (osm_type, osm_id, name, name_norm, category, category_value, geom, source_id, extract_date, land) values
     ('node', 21, 'Café Königsbau', 'cafe konigsbau', 'amenity', 'cafe', ${PT(9.18, 48.78)}, 'osm', '2026-11-01', 'baden-wuerttemberg')`,
  `insert into public.osm_addresses (osm_type, osm_id, street, house_number, postcode, place, street_norm, house_number_norm, place_norm, geom, source_id, extract_date) values
     ('way', 31, 'Königstraße', '1A', '70173', 'Stuttgart', 'konigstrasse', '1a', 'stuttgart', ${PT(9.18, 48.78)}, 'osm', '2026-11-01')`,
  `insert into public.delfi_service_alerts (source_id, source_feed, alert_id, header, effect, line_names, dedupe_key, content_hash, confidentiality) values
     ('delfi_rt_sa', 'delfi_rt_sa', 'a1', 'Bauarbeiten S1', 'DETOUR', '{S1}', 'd1', 'h1', null),
     ('delfi_rt_sa', 'delfi_rt_sa', 'a2', 'Intern', 'OTHER_EFFECT', '{}', 'd2', 'h2', 'restrictedToAuthorities')`,
  `insert into public.street_bays (bay_id, external_id, kind, street, postcode, city, geom, first_seen_at, last_seen_at, source_feed, source_publisher, spaces) values
     ('dortmund:b1', 'b1', 'disabled', 'Kuhstraße', '44137', 'Dortmund', ${PT(7.46, 51.51)}, now(), now(), 'dortmund_parksensoren_bays', 'Dortmund', 1)`,
  `insert into public.street_bay_state (bay_id, state, message_at, last_seen_at, source_feed, source_publisher) values
     ('dortmund:b1', 'free', now(), now(), 'dortmund_parksensoren', 'Dortmund')`,
  `insert into public.charging_sites (source_feed, site_id, name, operator, geom, first_seen_at, updated_at) values
     ('bnetza_lsr', 's1', 'Ladesäule', 'EnBW', ${PT(9.18, 48.78)}, now(), now())`,
  `insert into public.charging_points (source_feed, point_key, site_id, evse_id, max_power_kw, geom, connector_types, price_per_kwh, extras) values
     ('bnetza_lsr', 'p1', 's1', 'DE*ENB*E1', 150, ${PT(9.18, 48.78)}, '{iec62196T2COMBO,iec62196T2}', 0.59,
      '{"device": {"openingHours": "247", "payment": "Kreditkarte;Kostenlos", "parking": "nur für Kunden"}}')`,
  `insert into public.fuel_stations (id, name, brand, geom, source, street, house_no, postcode, city, opening_times, whole_day, first_seen_at, updated_at) values
     ('st-1', 'Tankstelle', 'ARAL', ${PT(9.18, 48.78)}, 'tankerkoenig', 'Hauptstraße', '1', '70173', 'Stuttgart',
      '[{"text": "Mo-Fr", "start": "06:00:00", "end": "22:00:00"}]', false, now(), now())`,
  `insert into public.parking_facilities (id, source_feed, external_id, kind, name, geom, attribution_id, facilities, facilities_absent, facilities_source) overriding system value values
     (7, 'mobilithek_park_x', 'x7', 'car_park', 'Parkhaus', ${PT(9.18, 48.78)}, 'mobilithek_park_x', '{toilet}', '{shower}', 'mobilithek_park_x')`,
];

beforeAll(async () => {
  await db.make([]);
  for (const s of SEED) await db.pool.query(s);
});
afterAll(async () => {
  await db.drop();
});

/** Reads as api_reader (its privileges), in a transaction that is rolled back. */
async function read<R extends pg.QueryResultRow>(sql: string): Promise<R[]> {
  const c = await db.pool.connect();
  try {
    await c.query("begin");
    await c.query("set local role api_reader");
    return (await c.query<R>(sql)).rows;
  } finally {
    await c.query("rollback");
    c.release();
  }
}

describe("the 0.3 read additions", () => {
  it("hydrogen_station: an open station with its refill and opening as published; a closed one is gone", async () => {
    expect(await read("select station_id, name, operator_name, refill, opening, source_ref, display_class, audience from contract.hydrogen_station")).toEqual([
      { station_id: "mobilithek_h2_stations:1", name: "H2 Stuttgart", operator_name: "H2 Mobility", refill: [{ solution: "700bar" }], opening: { text: "24/7" }, source_ref: "mobilithek_h2_stations", display_class: "open", audience: "public" },
    ]);
  });

  it("speed_camera: an OSM camera, an official point with no position but its AGS, and a Hamburg camera under its origin's condition", async () => {
    expect(await read("select camera_id, camera_kind, location is not null as placed, admin_code, land_name, max_speed_kmh, valid_from::text, source_ref, display_class, origin_restriction from contract.speed_camera order by 1")).toEqual([
      { camera_id: "hh:c1", camera_kind: "fixed", placed: true, admin_code: "02000000", land_name: "hamburg", max_speed_kmh: null, valid_from: null, source_ref: "hh_verkehrskameras", display_class: "open", origin_restriction: null },
      { camera_id: "osm:node11", camera_kind: "fixed", placed: true, admin_code: null, land_name: "baden-wuerttemberg", max_speed_kmh: 50, valid_from: null, source_ref: "osm_speed_cameras", display_class: "open", origin_restriction: null },
      { camera_id: "se:5", camera_kind: "mobile_announced", placed: false, admin_code: "05315000", land_name: null, max_speed_kmh: 50, valid_from: "2026-11-17", source_ref: "koeln_blitzer", display_class: "open", origin_restriction: null },
    ]);
  });

  it("sharing: the stations and vehicles of an admitted system only, with the system's name", async () => {
    expect(await read("select station_id, system_name, name, capacity, source_ref from contract.sharing_station")).toEqual([
      { station_id: "nb-s:st1", system_name: "nextbike Stuttgart", name: "Hauptbahnhof", capacity: 12, source_ref: "gbfs_nextbike" },
    ]);
    expect(await read("select vehicle_id, form_factor, propulsion, source_ref from contract.sharing_vehicle")).toEqual([
      { vehicle_id: "nb-s:1", form_factor: "bicycle", propulsion: "electric_assist", source_ref: "gbfs_nextbike" },
    ]);
    expect(await read("select count(*)::int as n from contract.sharing_station_status")).toEqual([{ n: 0 }]);
  });

  it("poi and address: the OSM rows with the platform's folds", async () => {
    expect(await read("select poi_id, name, name_fold, category, category_value, land_name, source_ref from contract.poi")).toEqual([
      { poi_id: "osm:node21", name: "Café Königsbau", name_fold: "cafe konigsbau", category: "amenity", category_value: "cafe", land_name: "baden-wuerttemberg", source_ref: "osm" },
    ]);
    expect(await read("select address_id, street, street_fold, house_number_fold, postcode, place_fold, source_ref from contract.address")).toEqual([
      { address_id: "osm:way31", street: "Königstraße", street_fold: "konigstrasse", house_number_fold: "1a", postcode: "70173", place_fold: "stuttgart", source_ref: "osm" },
    ]);
  });

  it("service_alert: an alert with its lines; a restricted one is withheld", async () => {
    expect(await read("select alert_id, header, effect, line_names, display_class from contract.service_alert order by 1")).toEqual([
      { alert_id: "delfi_rt_sa:a1", header: "Bauarbeiten S1", effect: "DETOUR", line_names: ["S1"], display_class: "open" },
      { alert_id: "delfi_rt_sa:a2", header: "Intern", effect: "OTHER_EFFECT", line_names: [], display_class: "withhold" },
    ]);
  });

  it("transit_punctuality: no area is listed while no trip was seen", async () => {
    expect(await read("select count(*)::int as n from contract.transit_punctuality")).toEqual([{ n: 0 }]);
  });

  it("street_bay: a disabled-badge bay with its newest sensor state", async () => {
    expect(await read("select bay_id, bay_kind, street, spaces, state, source_ref from contract.street_bay")).toEqual([
      { bay_id: "dortmund:b1", bay_kind: "disabled", street: "Kuhstraße", spaces: 1, state: "free", source_ref: "dortmund_parksensoren_bays" },
    ]);
  });

  it("the appended columns: a point's plugs and register terms, a station's address and hours, a car park's amenities", async () => {
    expect(await read("select connectors, price_per_kwh::text, opening_hours_kind, payment_card, free_of_charge, parking_access from contract.charge_point")).toEqual([
      { connectors: ["ccs2", "type2"], price_per_kwh: "0.590", opening_hours_kind: "always", payment_card: true, free_of_charge: true, parking_access: "customers" },
    ]);
    expect(await read("select street, house_number, postcode, city, opening_times, whole_day from contract.fuel_station")).toEqual([
      { street: "Hauptstraße", house_number: "1", postcode: "70173", city: "Stuttgart", opening_times: [{ text: "Mo-Fr", start: "06:00:00", end: "22:00:00" }], whole_day: false },
    ]);
    expect(await read("select parking_kind, stored_kind, amenities, amenities_absent from contract.parking_facility")).toEqual([
      { parking_kind: "other", stored_kind: "car_park", amenities: ["toilet"], amenities_absent: ["shower"] },
    ]);
  });
});
