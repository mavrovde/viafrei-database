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

/** Writes rows as the owner, then reads as api_reader, in one transaction that is rolled back. */
async function readAfter<R extends pg.QueryResultRow>(rows: readonly string[], sql: string): Promise<R[]> {
  const c = await db.pool.connect();
  try {
    await c.query("begin");
    for (const r of rows) await c.query(r);
    await c.query("set local role api_reader");
    return (await c.query<R>(sql)).rows;
  } finally {
    await c.query("rollback");
    c.release();
  }
}

describe("the region watch's trips, the station board's departures and the warn cells", () => {
  const tick = (trip: string, stop: string, delay: number | null, ago: string, rel = "SCHEDULED"): string =>
    `insert into public.transit_delays (observed_at, feed_ts, trip_id, stop_id, stop_sequence, delay_s, schedule_relationship, source)
       values (now() - interval '${ago}', now(), '${trip}', '${stop}', 1, ${delay === null ? "null" : String(delay)}, '${rel}', 'delfi_rt_tu')`;

  it("transit_trip_delay: each trip's largest delay of the last half hour per stop key, of DELFI's Trip Updates only", async () => {
    const rows = await readAfter<{ trip_ref: string; area_code: string; worst_delay_s: number }>(
      [
        tick("t1", "de:08111:6115:1:1", 120, "5 minutes"),
        tick("t1", "de:08111:6115:1:1", 900, "2 minutes"),
        tick("t1", "de:08116:100", 60, "1 minute"),
        tick("t2", "de:08111:6115", 30, "40 minutes"),
        tick("t3", "de:08111:6115", null, "1 minute", "SKIPPED"),
        tick("t4", "000123", 600, "1 minute"),
        tick("t5", "de:081110000001:1", 600, "1 minute"),
        `insert into public.transit_delays (observed_at, feed_ts, trip_id, stop_id, stop_sequence, delay_s, schedule_relationship, source)
           values (now(), now(), 't6', 'de:08111:1', 1, 700, 'SCHEDULED', 'vbb_rt')`,
      ],
      "select trip_ref, area_code, worst_delay_s from contract.transit_trip_delay order by 1, 2",
    );
    expect(rows).toEqual([
      { trip_ref: "t1", area_code: "08111", worst_delay_s: 900 },
      { trip_ref: "t1", area_code: "08116", worst_delay_s: 60 },
    ]);
  });

  it("station_disruption: a station's departures of the next hour per minute, line and live feed, cancelled and late, through its DHID and the bridge", async () => {
    const call = (ref: string, journey: string, line: string | null, feed: string, aimed: string, delay: number | null, cancelled = false, recorded = false): string =>
      `insert into public.delfi_siri_et_calls_latest (stop_ref, service_day, journey_ref, visit, source_feed, observed_at, line, category, destination, platform, aimed_dep, expected_dep, delay_s, recorded, cancelled, journey_cancelled)
         values ('${ref}', current_date, '${journey}', 1, '${feed}', now() - interval '1 minute', ${line === null ? "null" : `'${line}'`}, null, 'Ziel', null,
                 date_trunc('minute', now()) + interval '${aimed}', date_trunc('minute', now()) + interval '${aimed}' + make_interval(secs => ${String(delay ?? 0)}),
                 ${delay === null ? "null" : String(delay)}, ${String(recorded)}, ${String(cancelled)}, false)`;
    const live = (feed: string, ago: string): string[] => [
      `insert into public.feed_catalog (feed_key, provider, display_name, licence_id, cadence_s) values ('${feed}', 'delfi', '${feed}', 'cc-by-sa', 120) on conflict do nothing`,
      `insert into control.feed_state (ledger, key, last_success_at, updated_at) values ('feed', '${feed}', now() - interval '${ago}', now())
         on conflict (ledger, key) do update set last_success_at = excluded.last_success_at`,
    ];
    const rows = await readAfter<{ station_ifopt: string; line_key: string; source_ref: string; departures: number; cancelled: number; late: number; display_class: string }>(
      [
        `insert into public.db_stations (station_no, name, content_hash, first_seen_at, last_seen_at, updated_at, ifopt, source_id) values
           ('8000096', 'Stuttgart Hbf', 'x', now(), now(), now(), 'de:08111:6115', 'db_stada'),
           ('8000001', 'Ohne Seite', 'x', now(), now(), now(), 'de:08111:9', 'db_stada')`,
        `insert into public.station_slugs (slug, station_no, name) values ('stuttgart-hbf', '8000096', 'Stuttgart Hbf')`,
        `insert into public.delfi_siri_et_stop_pairs (eva, dhid, station_dhid, matches, first_seen_at, confirmed_at) values ('8000096', 'de:08111:6115:1:1', 'de:08111:6115', 1, now(), now())`,
        ...live("delfi_siri_et_bw", "1 minute"),
        ...live("delfi_siri_et_db", "1 minute"),
        ...live("delfi_siri_et_old", "2 hours"),
        // one journey through the DHID and the bridged EVA is one departure; a cancelled one and a late one at one minute
        call("de:08111:6115", "j1", "S 1", "delfi_siri_et_bw", "10 minutes", 400),
        call("8000096", "j1", "S 1", "delfi_siri_et_bw", "10 minutes", 400),
        call("de:08111:6115", "j2", "S 1", "delfi_siri_et_bw", "10 minutes", null, true),
        call("8000096", "x9", "s1", "delfi_siri_et_db", "10 minutes", null, true),
        call("de:08111:6115", "j3", "S1", "delfi_siri_et_bw", "20 minutes", 60),
        call("8000096", "x8", null, "delfi_siri_et_db", "30 minutes", 0),
        // past the hour, recorded, of a dead feed, at a station with no page: not counted
        call("de:08111:6115", "j4", "RE5", "delfi_siri_et_bw", "90 minutes", 900),
        call("de:08111:6115", "j5", "RE5", "delfi_siri_et_bw", "15 minutes", 900, false, true),
        call("de:08111:6115", "j6", "RE5", "delfi_siri_et_old", "15 minutes", 900),
        call("de:08111:9", "j7", "RE5", "delfi_siri_et_bw", "15 minutes", 900),
      ],
      "select station_ifopt, line_key, source_ref, departures, cancelled, late, display_class from contract.station_disruption order by aimed_minute, line_key, source_ref",
    );
    expect(rows).toEqual([
      { station_ifopt: "de:08111:6115", line_key: "s1", source_ref: "delfi_siri_et_bw", departures: 2, cancelled: 1, late: 1, display_class: "open" },
      { station_ifopt: "de:08111:6115", line_key: "s1", source_ref: "delfi_siri_et_db", departures: 1, cancelled: 1, late: 0, display_class: "open" },
      { station_ifopt: "de:08111:6115", line_key: "s1", source_ref: "delfi_siri_et_bw", departures: 1, cancelled: 0, late: 0, display_class: "open" },
      { station_ifopt: "de:08111:6115", line_key: "x8", source_ref: "delfi_siri_et_db", departures: 1, cancelled: 0, late: 0, display_class: "open" },
    ]);
  });

  it("service_alert: the last delivery, the message number, whether the publication is the primary, and its publication's last check, cadence and pause", async () => {
    const alert = (source: string, feed: string, id: string, ref: string | null, seen: string): string =>
      `insert into public.delfi_service_alerts (source_id, source_feed, alert_id, header, dedupe_key, message_ref, content_hash, last_seen_at)
         values ('${source}', '${feed}', '${id}', 'Bauarbeiten', 'k-${id}', ${ref === null ? "null" : `'${ref}'`}, 'h-${id}', '${seen}')`;
    const rows = await readAfter<Record<string, unknown>>(
      [
        `insert into public.feed_catalog (feed_key, provider, display_name, licence_id, cadence_s) values ('service_alerts_gtfsrt', 'delfi', 'alerts', 'cc-by-sa', 300) on conflict do nothing`,
        `insert into control.feed_state (ledger, key, last_success_at, updated_at) values ('feed', 'service_alerts_gtfsrt', '2026-11-16 08:00+00', now())
           on conflict (ledger, key) do update set last_success_at = excluded.last_success_at`,
        alert("delfi_rt_sa", "service_alerts_gtfsrt", "a1", null, "2026-11-16 08:00+00"),
        alert("delfi_siri_sx", "service_alerts_siri_sx", "s1", "m-7", "2026-11-15 08:00+00"),
      ],
      `select alert_id, seen_at, message_ref, primary_source, checked_at is not null as checked, cadence_s, paused from contract.service_alert
        where alert_id in ('service_alerts_gtfsrt:a1', 'service_alerts_siri_sx:s1') order by alert_id`,
    );
    expect(rows).toEqual([
      { alert_id: "service_alerts_gtfsrt:a1", seen_at: new Date("2026-11-16T08:00:00Z"), message_ref: null, primary_source: true, checked: true, cadence_s: 300, paused: false },
      { alert_id: "service_alerts_siri_sx:s1", seen_at: new Date("2026-11-15T08:00:00Z"), message_ref: "m-7", primary_source: false, checked: false, cadence_s: null, paused: false },
    ]);
  });

  it("weather_warning: the warn cell, its name and boundary, the DWD event and the message", async () => {
    const rows = await readAfter<{ warn_cell_id: string; area_name: string; event: string; identifier: string; holds: boolean }>(
      [
        `insert into public.weather_warnings (id, source_feed, source_id, identifier, warncell_id, version, level, event, official_sha256, area_sha256, valid_from, raw, area_desc, area)
           overriding system value values (77, 'dwd_warnings', 'dwd', 'msg-1', '808111000', 1, 2, 'STURMBÖEN', repeat('a', 64), repeat('b', 64), now(), '{}', 'Stadt Stuttgart',
           st_multi(st_makeenvelope(9.0, 48.7, 9.3, 48.9, 4326))::geography)`,
      ],
      "select warn_cell_id, area_name, event, identifier, st_intersects(area, st_setsrid(st_makepoint(9.18, 48.78), 4326)) as holds from contract.weather_warning",
    );
    expect(rows).toEqual([{ warn_cell_id: "808111000", area_name: "Stadt Stuttgart", event: "STURMBÖEN", identifier: "msg-1", holds: true }]);
  });
});

describe("the low-emission-zone plaque: each zone's feed and the curated zone list", () => {
  beforeAll(async () => {
    const zone = (feed: string, id: string, name: string, x: number): string =>
      `('${feed}', 'Publisher', '${id}', 'zone', '${name}', '{}', st_setsrid(st_geomfromtext('POLYGON((${String(x)} 48, ${String(x + 0.1)} 48, ${String(x + 0.1)} 48.1, ${String(x)} 48.1, ${String(x)} 48))'), 4326), 'h-${id}', now(), '2026-11-16 08:00+00', null)`;
    await db.pool.query(
      `insert into public.lez_zones (source_feed, source_publisher, zone_id, role, name, props, geom, content_hash, first_seen_at, last_seen_at, provider_updated_at) values
         ${zone("muenchen_umweltzone", "m1", "Umweltzone", 11.5)}, ${zone("uba_umweltzonen", "DE_BY_1", "DE_BY_1", 11.7)}, ${zone("lez_unknown", "u1", "Zone", 11.9)}`,
    );
    await db.pool.query(`update public.lez_zones set provider_updated_at = '2025-06-24 00:00+00' where zone_id = 'DE_BY_1'`);
  });

  it("low_emission_zone: a city document names its Gemeinde and city, the register its scope alone, a feed the list does not name nothing; the data's own date and the last read", async () => {
    const rows = await read<Record<string, unknown>>(
      "select zone_key, source_scope, source_place_code, source_city, changed_at is not null as dated, recorded_at from contract.low_emission_zone order by zone_key",
    );
    expect(rows).toEqual([
      { zone_key: "lez_unknown/u1", source_scope: null, source_place_code: null, source_city: null, dated: false, recorded_at: new Date("2026-11-16T08:00:00Z") },
      { zone_key: "muenchen_umweltzone/m1", source_scope: "city", source_place_code: "09162000", source_city: "München", dated: false, recorded_at: new Date("2026-11-16T08:00:00Z") },
      { zone_key: "uba_umweltzonen/DE_BY_1", source_scope: "national", source_place_code: null, source_city: null, dated: true, recorded_at: new Date("2026-11-16T08:00:00Z") },
    ]);
  });

  it("low_emission_zone_entry: the curated list as the platform's, a zone in force with its plaque, a lifted one with its day and no plaque, a closed-licence one not covered", async () => {
    const rows = await read<Record<string, unknown>>(
      `select entry_key, name, place_codes, plaque, covered, to_char(lifted_on, 'YYYY-MM-DD') as lifted_on, source_ref from contract.low_emission_zone_entry
        where entry_key in ('berlin', 'hannover', 'duesseldorf', 'ruhrgebiet') order by entry_key`,
    );
    expect(rows.map((r) => [r["entry_key"], r["plaque"], r["covered"], r["lifted_on"], r["source_ref"]])).toEqual([
      ["berlin", "green", true, null, "viafrei_rules"],
      ["duesseldorf", null, false, null, "viafrei_rules"],
      ["hannover", null, true, "2024-02-22", "viafrei_rules"],
      ["ruhrgebiet", "green", true, null, "viafrei_rules"],
    ]);
    expect((rows.find((r) => r["entry_key"] === "ruhrgebiet")?.["place_codes"] as string[]).length).toBe(13);
    const n = await read<{ n: number; lifted: number }>("select count(*)::int as n, count(lifted_on)::int as lifted from contract.low_emission_zone_entry");
    expect(n).toEqual([{ n: 59, lifted: 23 }]);
  });
});
