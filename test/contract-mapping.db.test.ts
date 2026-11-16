/**
 * The contract views read the platform's tables (0312, #29). A database
 * migrated to head is seeded with a few rows of each source table, and every
 * mapped view is read back as api_reader: its rows, the mapping of their
 * values, and the licence envelope each row carries (source_ref, display_class,
 * audience, confidentiality, terms_gate, hold_reason, origin_restriction).
 * The views' columns and types are held by api-schemas.db.test.ts.
 */
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DomainDb } from "./domain-db.js";

const db = new DomainDb(process.env["TEST_DATABASE_URL"] ?? "", "map");

const PT = (lon: number, lat: number): string => `st_setsrid(st_makepoint(${String(lon)}, ${String(lat)}), 4326)::geography`;
const HEX = "a".repeat(64);
/** Midnight UTC today and one second after: two ticks of one UTC day, inside the last 24 hours. */
const T0 = "date_trunc('day', now(), 'UTC')";
const T1 = `(${T0} + interval '1 second')`;
const TODAY = "(now() at time zone 'Europe/Berlin')::date";

const SEED = [
  `insert into public.feed_catalog (feed_key, provider, display_name, licence_id, licence_label, attribution, offer_url, cadence_s) values
     ('mobilithek_park_x', 'mobilithek', 'Parken X', 'mobilithek_park_x', 'Datenlizenz Deutschland – Namensnennung – Version 2.0', 'Parken: X', 'https://example.org/offer/1', 300),
     ('truckpark_sid_static', 'mobilithek', 'SID', 'toll_collect_sid', 'Toll Collect SID 1.0', 'Lkw-Stellplätze: Toll Collect', null, 3600),
     ('delfi_rt_tu', 'mobilithek', 'DELFI RT', 'delfi_rt_tu', 'CC BY-SA 4.0', 'Echtzeitdaten: DELFI', null, 60),
     ('tankerkoenig_hist', 'tankerkoenig', 'History', 'tankerkoenig_hist', 'CC BY-NC-SA 4.0', 'x', null, 86400)`,
  `insert into public.ags_regions (ags, level, name, name_norm, parent_ags, geom, source_id) values ('08111', 'kreis', 'Stuttgart', 'stuttgart', '08', ${PT(9.18, 48.78)}, 'destatis_gv')`,
  `insert into public.gazetteer_places (id, kind, name, name_norm, name_en, admin_code, rank, geom, source_id, external_id) overriding system value values
     (1, 'city', 'Stuttgart', 'stuttgart', 'Stuttgart City', '08111000', 600000, ${PT(9.18, 48.78)}, 'geonames', '2825297')`,
  `insert into public.gazetteer_places (id, kind, name, name_norm, road, source_id, external_id) overriding system value values (2, 'motorway', 'A8', 'a8', 'A8', 'autobahn', 'A8')`,
  `insert into public.autobahn_roads (road) values ('A8')`,
  `insert into public.tmc_locations (cid, tabcd, lcd, lcl_version, class, tcd, stcd, junction_no, name, road_number, geom) values
     (58, 1, 1000, '22.0', 'P', 1, 3, '52', 'Stuttgart-Degerloch', 'A8', ${PT(9.17, 48.73)}),
     (58, 1, 1001, '22.0', 'P', 3, 1, null, 'Rastplatz', 'A8', ${PT(9.1, 48.7)})`,
  `insert into public.autobahn_events (observed_at, road, kind, ext_id, title, subtitle, abnormal_traffic_type, delay_s, geom, raw, raw_hash, source) values
     (${T0}, 'A8', 'roadworks', 'X1', 'A8 | Stuttgart', 'Baustelle', null, null, ${PT(9.17, 48.73)},
      '{"startTimestamp": "2026-11-10T06:00:00.000+01:00", "isBlocked": "true", "description": ["Zeile 1", "Zeile 2"]}', '\\x01', 'autobahn'),
     (${T0}, 'A8', 'roadworks', 'X0', 'A8 | alt', null, null, null, ${PT(9.17, 48.73)}, '{}', '\\x02', 'autobahn'),
     (${T1}, 'A8', 'roadworks', 'X1', 'A8 | Stuttgart', 'Baustelle', null, null, ${PT(9.17, 48.73)}, null, '\\x01', 'autobahn')`,
  `insert into public.road_events (id, feed_key, source_id, publication_id, version, payload, event_type, road_number, geom, overall_start, source_feed, first_seen_at, updated_at, confidentiality, deleted_at) overriding system value values
     (1, 'mobilithek_bab_messages', 'DE-MIA', 'S1', 2, '{}', 'MaintenanceWorks', 'A8', st_setsrid(st_makepoint(9.17, 48.73), 4326), '2026-11-01T00:00:00Z', 'mobilithek_bab_messages', now(), now(), null, null),
     (2, 'mobilithek_traffic_bw', 'DE-BW', 'S2', 1, '{}', 'Accident', 'B27', null, '2026-11-01T00:00:00Z', 'mobilithek_traffic_bw', now(), now(), 'restrictedToAuthorities', null),
     (3, 'mobilithek_bab_messages', 'DE-MIA', 'S3', 1, '{}', 'Accident', 'A8', null, '2026-11-01T00:00:00Z', 'mobilithek_bab_messages', now(), now(), null, now())`,
  `insert into public.road_event_ticks (observed_at, feed_key, source_id, publication_id, version, payload) values
     (now(), 'mobilithek_bab_messages', 'DE-MIA', 'S1', 2, '{}'),
     (now(), 'mobilithek_traffic_bw', 'DE-BW', 'S2', 1, '{}'),
     (now(), 'mobilithek_bab_messages', 'DE-MIA', 'S3', 1, '{}')`,
  `insert into public.fuel_stations (id, name, brand, geom, source, first_seen_at, updated_at) values ('st-1', 'Tankstelle', 'ARAL', ${PT(9.18, 48.78)}, 'tankerkoenig', now(), now())`,
  `insert into public.fuel_prices (observed_at, station_id, product, price, source) values (now(), 'st-1', 'e5', 1.799, 'tankerkoenig'), (now(), 'st-1', 'e10', 1.5, 'tankerkoenig_hist')`,
  `insert into public.charging_sites (source_feed, site_id, name, operator, geom, first_seen_at, updated_at, confidentiality) values
     ('afir_enbw_stat', 's1', 'Ladepark', 'EnBW', ${PT(9.18, 48.78)}, now(), now(), null),
     ('afir_enbw_stat', 's2', 'Privatparkplatz Hof', 'X', ${PT(9.18, 48.78)}, now(), now(), null),
     ('afir_eliso_stat', 's3', 'Eliso', 'eliso', ${PT(9.18, 48.78)}, now(), now(), 'restrictedToAuthorities')`,
  `insert into public.charging_points (source_feed, point_key, site_id, evse_id, current_type, max_power_kw, geom) values
     ('afir_enbw_stat', 'p1', 's1', 'DE*ABC*E1', 'AC_3_PHASE', 22, ${PT(9.18, 48.78)})`,
  `insert into public.charging_point_status (observed_at, evse_id, source_feed, raw, status) values (now(), 'DE*ABC*E1', 'afir_enbw_dyn', '{}', 'CHARGING')`,
  `insert into public.parking_facilities (id, source_feed, external_id, kind, name, operator, geom, attribution_id) overriding system value values
     (11, 'mobilithek_park_x', 'e1', 'park_and_ride', 'P+R Mitte', 'Stadt', ${PT(9.18, 48.78)}, 'mobilithek_park_x')`,
  `insert into public.parking_facilities_sid (id, source_feed, external_id, kind, name, geom, attribution_id) overriding system value values
     (12, 'truckpark_sid_static', 's1', 'truck', 'Rastanlage', ${PT(9.1, 48.7)}, 'toll_collect_sid')`,
  `insert into public.parking_occupancy (observed_at, facility_id, source_feed, raw, spaces_free, spaces_total, status) values (now(), 11, 'mobilithek_park_x', '{}', 10, 100, 'spacesAvailable')`,
  `insert into public.parking_occupancy_sid (observed_at, facility_id, source_feed, raw, spaces_free, spaces_total, status) values (now(), 12, 'truckpark_sid_dyn', '{}', 5, 40, 'almostFull')`,
  `insert into public.stops (gtfs_feed_key, id, name, geom, location_type, parent_id, platform_code) values
     (1, 'de:08111:6115', 'Stuttgart Hbf', ${PT(9.18, 48.78)}, 1, null, null),
     (1, 'de:08111:6115:1:1', 'Stuttgart Hbf', ${PT(9.18, 48.78)}, 0, 'de:08111:6115', '1')`,
  `insert into public.routes (gtfs_feed_key, id, route_type, short_name) values (1, 'r1', 109, 'S1')`,
  `insert into public.trips (gtfs_feed_key, id, route_id, service_id, headsign) values (1, 't1', 'r1', 'svc1', 'Herrenberg')`,
  `insert into public.gtfs_service_dates (service_date, gtfs_feed_key, service_id) values (${TODAY}, 1, 'svc1')`,
  `insert into public.stop_times (gtfs_feed_key, trip_id, stop_sequence, stop_id, arrival, departure) values
     (1, 't1', 1, 'de:08111:6115:1:1', '08:00', '08:01'), (1, 't1', 2, 'de:08111:6115:1:1', '25:10', '25:10')`,
  `refresh materialized view public.transit_stop_modes`,
  `insert into public.transit_delays (observed_at, feed_ts, trip_id, stop_id, stop_sequence, delay_s, schedule_relationship, source) values
     (now(), now(), 't1', 'de:08111:6115:1:1', 1, 120, 'SCHEDULED', 'delfi_rt_tu')`,
  `insert into public.station_equipment (equipment_id, kind, stop_place_id, description, first_seen_at, last_seen_at, source_feed, source_publisher) values
     ('eq1', 'elevator', 'de:08111:6115', 'Gleis 1', now(), now(), 'openstation_netex', 'DB')`,
  `insert into public.station_equipment_state (equipment_id, status, state, status_since, last_seen_at, known_equipment, source_feed, source_publisher) values
     ('eq1', 'INACTIVE', 'inactive', '2026-11-15T10:00:00Z', now(), true, 'openstation_siri_fm', 'DB')`,
  `insert into public.db_facilities (equipment_no, station_no, kind, state, state_since, first_seen_at, last_seen_at, source_feed, source_publisher, description) values
     ('10500', '1071', 'escalator', 'active', '2026-11-15T10:00:00Z', now(), now(), 'db_fasta', 'DB', 'Ausgang')`,
  `insert into public.weather_warnings (id, source_feed, source_id, identifier, warncell_id, version, level, severity, event, headline, official_sha256, area_sha256, valid_from, raw) overriding system value values
     (1, 'dwd_cap', 'dwd', 'w1', '108111000', 1, 2, 'Moderate', 'STURMBÖEN', 'Amtliche WARNUNG vor STURMBÖEN', '${HEX}', '${HEX}', now(), '{}')`,
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

describe("register views", () => {
  it("source: a feed with its catalogue licence, offer page and stale rule, the register's attribution, conditions and review where its licence id names a register row; SID gated and held; an excluded source has no row", async () => {
    const r = await read(
      "select source_ref, domain, licence_code, attribution_text, changes_statement, terms_url, acceptance_required, use_classes, freshness_target_s, stale_after_s, review_signed_on::text as rev, register_version::text as ver, display_class, audience, terms_gate, hold_reason from contract.source where source_ref in ('delfi_rt_tu', 'mobilithek_park_x', 'truckpark_sid_static', 'tankerkoenig_hist', 'toll_collect_sid') order by 1",
    );
    expect(r).toEqual([
      { source_ref: "delfi_rt_tu", domain: "transit", licence_code: "CC BY-SA 4.0", attribution_text: "Echtzeitdaten: DELFI e.V. via Mobilithek, CC BY-SA, bearbeitet", changes_statement: "bearbeitet", terms_url: null, acceptance_required: false, use_classes: ["consumer", "non_commercial"], freshness_target_s: 60, stale_after_s: 180, rev: "2026-10-12", ver: "2026-11-14", display_class: "open", audience: "public", terms_gate: null, hold_reason: null },
      { source_ref: "mobilithek_park_x", domain: "parking", licence_code: "Datenlizenz Deutschland – Namensnennung – Version 2.0", attribution_text: "Parken: X", changes_statement: null, terms_url: "https://example.org/offer/1", acceptance_required: false, use_classes: [], freshness_target_s: 300, stale_after_s: 900, rev: null, ver: "2026-11-14", display_class: "open", audience: "public", terms_gate: null, hold_reason: null },
      { source_ref: "truckpark_sid_static", domain: "parking", licence_code: "Toll Collect SID 1.0", attribution_text: "Lkw-Stellplätze: Toll Collect GmbH, Stellplatz-Informationsdienst (SID) via Mobilithek, Nutzungsbedingungen Version 1.0 (Stand 10.04.2026)", changes_statement: null, terms_url: null, acceptance_required: true, use_classes: ["consumer"], freshness_target_s: 3600, stale_after_s: 10800, rev: "2026-10-26", ver: "2026-11-14", display_class: "gated", audience: "own", terms_gate: "sid-terms-1", hold_reason: "no_api_terms" },
    ]);
    const pub = await read<{ n: number }>("select count(*)::int as n from contract.publisher p join contract.source s on s.publisher_id = p.publisher_id");
    const src = await read<{ n: number }>("select count(*)::int as n from contract.source");
    expect(pub[0]?.n).toBe(src[0]?.n);
  });

  it("source: the register's static sources resolve with their domain, licence, use classes and review; a restricted source keeps the consumer class only; no cadence = one year", async () => {
    const r = await read(
      "select source_ref, domain, licence_code, array_to_string(use_classes, ',') as uses, acceptance_required as acc, stale_after_s, review_signed_on::text as rev, display_class, audience from contract.source where source_ref in ('geonames', 'destatis_gv_laender', 'db_fasta', 'dwd', 'viafrei_rules', 'tankerkoenig', 'mobilithek_afir_eliso_stat', 'mobilithek_park_bosch_static') order by 1",
    );
    const all = "consumer,non_commercial,commercial";
    const year3 = 3 * 31536000;
    expect(r).toEqual([
      { source_ref: "db_fasta", domain: "transit", licence_code: "CC BY 4.0", uses: all, acc: false, stale_after_s: year3, rev: "2026-09-20", display_class: "open", audience: "public" },
      { source_ref: "destatis_gv_laender", domain: "places", licence_code: "dl-de/by-2-0", uses: all, acc: false, stale_after_s: year3, rev: "2026-11-03", display_class: "open", audience: "public" },
      { source_ref: "dwd", domain: "weather", licence_code: "CC BY 4.0", uses: all, acc: false, stale_after_s: year3, rev: "2026-10-23", display_class: "open", audience: "public" },
      { source_ref: "geonames", domain: "places", licence_code: "CC BY 4.0", uses: all, acc: false, stale_after_s: year3, rev: "2026-10-08", display_class: "open", audience: "public" },
      { source_ref: "mobilithek_afir_eliso_stat", domain: "energy", licence_code: "AFIR Art. 20, keine Lizenz angegeben", uses: "consumer", acc: false, stale_after_s: year3, rev: "2026-10-25", display_class: "consumer_only", audience: "public" },
      { source_ref: "mobilithek_park_bosch_static", domain: "parking", licence_code: "CC BY 4.0", uses: "consumer", acc: false, stale_after_s: year3, rev: "2026-10-04", display_class: "consumer_only", audience: "public" },
      { source_ref: "tankerkoenig", domain: "energy", licence_code: "CC BY 4.0", uses: "consumer", acc: false, stale_after_s: year3, rev: "2026-11-13", display_class: "no_redistribution", audience: "own" },
      { source_ref: "viafrei_rules", domain: "rules", licence_code: "ViaFrei editorial content (informational, not legal advice)", uses: all, acc: false, stale_after_s: year3, rev: "2026-09-19", display_class: "open", audience: "public" },
    ]);
    // A register row a feed's licence id names is that feed's, never a second source.
    expect(await read("select source_ref from contract.source where source_ref in ('delfi_rt_tu', 'toll_collect_sid', 'tankerkoenig_hist') order by 1")).toEqual([{ source_ref: "delfi_rt_tu" }]);
  });

  it("source_note: the conditions and the MTS-K purpose note, verbatim, under the feed that names the register row", async () => {
    const r = await read<{ source_ref: string; note_kind: string; lang: string; body: string }>(
      "select source_ref, note_kind, lang, body from contract.source_note where source_ref in ('tankerkoenig', 'truckpark_sid_static', 'mobilithek_traffic_bw') order by 1, 2, 3",
    );
    expect(r.map((n) => `${n.source_ref}/${n.note_kind}/${n.lang}`)).toEqual([
      "mobilithek_traffic_bw/condition/de",
      "mobilithek_traffic_bw/condition/en",
      "tankerkoenig/purpose/de",
      "tankerkoenig/purpose/en",
      "truckpark_sid_static/condition/de",
      "truckpark_sid_static/condition/en",
    ]);
    expect(r[2]?.body).toMatch(/^Hinweis zu den Kraftstoffpreisdaten \(MTS-K\): Diese Daten dürfen ausschließlich zum Zweck der Verbraucherinformation verwendet werden;/);
    expect(r[3]?.body).toBe(r[2]?.body);
    expect(r[5]?.body).toMatch(/terms of use, section 2, apply/);
  });

  it("licence: a label's URL, category, share-alike and attribution flags", async () => {
    const r = await read("select licence_code, licence_url, licence_category, share_alike, attribution_required from contract.licence where licence_code in ('CC BY-SA 4.0', 'Datenlizenz Deutschland – Namensnennung – Version 2.0') order by 1");
    expect(r).toEqual([
      { licence_code: "CC BY-SA 4.0", licence_url: "https://creativecommons.org/licenses/by-sa/4.0/", licence_category: "share_alike", share_alike: true, attribution_required: true },
      { licence_code: "Datenlizenz Deutschland – Namensnennung – Version 2.0", licence_url: "https://www.govdata.de/dl-de/by-2-0", licence_category: "attribution", share_alike: false, attribution_required: true },
    ]);
  });
});

describe("reference views", () => {
  it("admin_region: Land and Kreis, with their parent and source", async () => {
    expect(await read("select region_code, region_level, name, parent_code, boundary, source_ref from contract.admin_region where region_code in ('08', '08111') order by 1")).toEqual([
      { region_code: "08", region_level: "state", name: "Baden-Württemberg", parent_code: null, boundary: null, source_ref: "destatis_gv" },
      { region_code: "08111", region_level: "district", name: "Stuttgart", parent_code: "08", boundary: null, source_ref: "destatis_gv" },
    ]);
  });

  it("place and place_alias: a located gazetteer row, its Kreis, rank and names; a row with no location is not a place", async () => {
    expect(await read("select place_id, place_kind, region_code, official_key, prominence, source_ref, origin_key, source_refs, st_astext(location) as at from contract.place")).toEqual([
      { place_id: "1", place_kind: "municipality", region_code: "08111", official_key: "08111000", prominence: 600000, source_ref: "geonames", origin_key: "2825297", source_refs: ["geonames"], at: "POINT(9.18 48.78)" },
    ]);
    expect(await read("select label, lang, name_kind, search_fold from contract.place_alias order by 1")).toEqual([
      { label: "Stuttgart", lang: null, name_kind: "name", search_fold: "stuttgart" },
      { label: "Stuttgart City", lang: "en", name_kind: "exonym", search_fold: "stuttgart city" },
    ]);
  });

  it("road and junction: the A-road list (Autobahn API: own audience) and its TMC junctions only", async () => {
    expect(await read("select road_ref, road_class, states, source_ref, display_class, audience from contract.road")).toEqual([
      { road_ref: "A8", road_class: "motorway", states: null, source_ref: "autobahn", display_class: "consumer_only", audience: "own" },
    ]);
    expect(await read("select junction_id, road_ref, number, name, junction_kind, chainage_km from contract.junction")).toEqual([
      { junction_id: "58:1:1000", road_ref: "A8", number: "52", name: "Stuttgart-Degerloch", junction_kind: "junction", chainage_km: null },
    ]);
  });
});

describe("roads", () => {
  it("traffic_event: the newest Autobahn sweep with its payload resolved from an earlier tick, and DATEX rows with their marking; a retracted row is not there", async () => {
    const r = await read(
      `select event_id, event_kind, road_class, headline, description, is_blocked, valid_from = '2026-11-10T05:00:00Z' as from_payload, record_class,
              source_ref, display_class, audience, confidentiality, origin_restriction from contract.traffic_event order by 1`,
    );
    expect(r).toEqual([
      { event_id: "autobahn:X1", event_kind: "roadworks", road_class: "motorway", headline: "A8 | Stuttgart", description: "Zeile 1\nZeile 2", is_blocked: true, from_payload: true, record_class: "operator_event", source_ref: "autobahn", display_class: "consumer_only", audience: "own", confidentiality: null, origin_restriction: null },
      { event_id: "datex:DE-BW:S2", event_kind: "accident", road_class: "federal", headline: "Accident", description: null, is_blocked: null, from_payload: false, record_class: "traffic_message", source_ref: "mobilithek_traffic_bw", display_class: "withhold", audience: "own", confidentiality: "restrictedToAuthorities", origin_restriction: "bw_rvwd" },
      { event_id: "datex:DE-MIA:S1", event_kind: "roadworks", road_class: "motorway", headline: "MaintenanceWorks", description: null, is_blocked: null, from_payload: false, record_class: "traffic_message", source_ref: "mobilithek_bab_messages", display_class: "open", audience: "public", confidentiality: null, origin_restriction: null },
    ]);
  });

  it("traffic_event_observation: every Autobahn tick and the ticks of events we did not retract", async () => {
    expect(await read("select event_id, version_no, display_class from contract.traffic_event_observation order by 1, observed_at")).toEqual([
      { event_id: "autobahn:X0", version_no: null, display_class: "consumer_only" },
      { event_id: "autobahn:X1", version_no: null, display_class: "consumer_only" },
      { event_id: "autobahn:X1", version_no: null, display_class: "consumer_only" },
      { event_id: "datex:DE-BW:S2", version_no: 1, display_class: "withhold" },
      { event_id: "datex:DE-MIA:S1", version_no: 2, display_class: "open" },
    ]);
  });
});

describe("fuel", () => {
  it("fuel_station and prices: Tankerkoenig for own keys only, no redistribution; the NC history is never mapped", async () => {
    expect(await read("select station_id, name, brand, open_state, source_ref, display_class, audience from contract.fuel_station")).toEqual([
      { station_id: "st-1", name: "Tankstelle", brand: "ARAL", open_state: "unknown", source_ref: "tankerkoenig", display_class: "no_redistribution", audience: "own" },
    ]);
    expect(await read("select station_id, product_code, price::text as price, currency, source_ref, display_class, audience from contract.fuel_price_observation")).toEqual([
      { station_id: "st-1", product_code: "e5", price: "1.799", currency: "EUR", source_ref: "tankerkoenig", display_class: "no_redistribution", audience: "own" },
    ]);
    expect(await read("select product_code, price_unit from contract.fuel_product where product_code = 'e5'")).toEqual([{ product_code: "e5", price_unit: "EUR/l" }]);
  });
});

describe("charging", () => {
  it("charging_site: access, a private or confidential site withheld but carried, an eliso site consumer-only", async () => {
    expect(await read("select site_id, access, operator_name, display_class, audience, confidentiality, access_private, operator_is_person from contract.charging_site order by 1")).toEqual([
      { site_id: "afir_eliso_stat:s3", access: "public", operator_name: "eliso", display_class: "withhold", audience: "public", confidentiality: "restrictedToAuthorities", access_private: false, operator_is_person: null },
      { site_id: "afir_enbw_stat:s1", access: "public", operator_name: "EnBW", display_class: "open", audience: "public", confidentiality: null, access_private: false, operator_is_person: null },
      { site_id: "afir_enbw_stat:s2", access: "restricted", operator_name: "X", display_class: "withhold", audience: "public", confidentiality: null, access_private: true, operator_is_person: null },
    ]);
  });

  it("charge_point and its state: ids, current, power, availability", async () => {
    expect(await read("select point_id, site_id, evse_code, current_kind, power_max_kw::text as kw, source_ref from contract.charge_point")).toEqual([
      { point_id: "afir_enbw_stat:p1", site_id: "afir_enbw_stat:s1", evse_code: "DE*ABC*E1", current_kind: "ac", kw: "22.00", source_ref: "afir_enbw_stat" },
    ]);
    expect(await read("select point_id, availability, source_ref, display_class from contract.charge_point_state_observation")).toEqual([
      { point_id: "afir_enbw_dyn:DE*ABC*E1", availability: "occupied", source_ref: "afir_enbw_dyn", display_class: "open" },
    ]);
  });
});

describe("parking", () => {
  it("parking_facility and occupancy: a plain facility open; a SID facility and its figure gated, held and own", async () => {
    expect(await read("select facility_id, parking_kind, operator_name, acceptance_required, source_ref, display_class, audience, terms_gate, hold_reason from contract.parking_facility order by 1")).toEqual([
      { facility_id: "p:11", parking_kind: "park_and_ride", operator_name: "Stadt", acceptance_required: false, source_ref: "mobilithek_park_x", display_class: "open", audience: "public", terms_gate: null, hold_reason: null },
      { facility_id: "sid:12", parking_kind: "truck_parking", operator_name: null, acceptance_required: true, source_ref: "truckpark_sid_static", display_class: "gated", audience: "own", terms_gate: "sid-terms-1", hold_reason: "no_api_terms" },
    ]);
    expect(await read("select facility_id, free_spaces, total_spaces, occupancy_status, display_class, audience, terms_gate, hold_reason from contract.occupancy_observation order by 1")).toEqual([
      { facility_id: "p:11", free_spaces: 10, total_spaces: 100, occupancy_status: "free", display_class: "open", audience: "public", terms_gate: null, hold_reason: null },
      { facility_id: "sid:12", free_spaces: 5, total_spaces: 40, occupancy_status: "filling", display_class: "gated", audience: "own", terms_gate: "sid-terms-1", hold_reason: "no_api_terms" },
    ]);
  });
});

describe("transit", () => {
  it("stop_place, stop_point and transit_line from the static GTFS", async () => {
    expect(await read("select stop_place_id, national_stop_code, region_code, modes, search_fold, source_ref from contract.stop_place")).toEqual([
      { stop_place_id: "1:de:08111:6115", national_stop_code: "de:08111:6115", region_code: "08111", modes: ["sbahn"], search_fold: "stuttgart hbf", source_ref: "delfi_static" },
    ]);
    expect(await read("select stop_point_id, stop_place_id, platform_label from contract.stop_point")).toEqual([
      { stop_point_id: "1:de:08111:6115:1:1", stop_place_id: "1:de:08111:6115", platform_label: "1" },
    ]);
    expect(await read("select line_id, line_name, transport_mode, source_ref from contract.transit_line")).toEqual([
      { line_id: "1:r1", line_name: "S1", transport_mode: "sbahn", source_ref: "delfi_static" },
    ]);
  });

  it("journey and scheduled_call: a trip per service date, times past 24:00 on the next day in Berlin", async () => {
    const day = (await db.pool.query<{ d: string }>(`select to_char(${TODAY}, 'YYYYMMDD') as d`)).rows[0]?.d ?? "";
    expect(await read("select journey_id, line_id, destination_label, extra from contract.journey")).toEqual([
      { journey_id: `1:t1:${day}`, line_id: "1:r1", destination_label: "Herrenberg", extra: false },
    ]);
    expect(
      await read(
        `select call_order, stop_point_id, planned_platform,
                to_char(planned_arrival_at at time zone 'Europe/Berlin', 'HH24:MI') as arr,
                (planned_arrival_at at time zone 'Europe/Berlin')::date - ${TODAY} as days,
                to_char(planned_departure_at at time zone 'Europe/Berlin', 'HH24:MI') as dep
           from contract.scheduled_call order by call_order`,
      ),
    ).toEqual([
      { call_order: 1, stop_point_id: "1:de:08111:6115:1:1", planned_platform: "1", arr: "08:00", days: 0, dep: "08:01" },
      { call_order: 2, stop_point_id: "1:de:08111:6115:1:1", planned_platform: "1", arr: "01:10", days: 1, dep: "01:10" },
    ]);
  });

  it("call_observation: the planned call plus the delay, CC BY-SA source", async () => {
    expect(
      await read(
        `select call_order, call_status, source_ref, to_char(expected_departure_at at time zone 'Europe/Berlin', 'HH24:MI') as dep from contract.call_observation`,
      ),
    ).toEqual([{ call_order: 1, call_status: "scheduled", source_ref: "delfi_rt_tu", dep: "08:03" }]);
  });
});

describe("stations and weather", () => {
  it("station_facility: an OpenStation lift with its state, and a FaSta escalator", async () => {
    expect(await read("select facility_id, stop_place_id, facility_kind, position_text, facility_status, source_ref from contract.station_facility order by 1")).toEqual([
      { facility_id: "equipment:eq1", stop_place_id: "1:de:08111:6115", facility_kind: "elevator", position_text: "Gleis 1", facility_status: "inactive", source_ref: "openstation_siri_fm" },
      { facility_id: "fasta:10500", stop_place_id: null, facility_kind: "escalator", position_text: "Ausgang", facility_status: "active", source_ref: "db_fasta" },
    ]);
  });

  it("weather_warning: hazard, level, the Kreis of the warn cell, the DWD as issuer", async () => {
    expect(await read("select warning_id, hazard, warning_level, level_label, message_status, issuer_name, region_code, source_ref from contract.weather_warning")).toEqual([
      { warning_id: "dwd:1", hazard: "wind", warning_level: 2, level_label: "Moderate", message_status: "actual", issuer_name: "Deutscher Wetterdienst", region_code: "08111", source_ref: "dwd_cap" },
    ]);
  });
});

describe("rules and coverage", () => {
  it("rule_topic and rule_statement: the curated topics and facts, German first, English appended, each with its legal basis, review date and to-verify note", async () => {
    const t = await read("select topic_code, title, title_en, reviewed_on::text as rev, source_ref, display_class, audience from contract.rule_topic order by 1");
    expect(t.map((x) => x["topic_code"] as string)).toEqual(["alcohol", "emergency", "equipment", "ev", "lez", "speed", "toll", "truck_ban", "winter"]);
    expect(t.find((x) => x["topic_code"] === "speed")).toEqual({ topic_code: "speed", title: "Geschwindigkeiten", title_en: "Speed limits", rev: "2026-09-19", source_ref: "viafrei_rules", display_class: "open", audience: "public" });
    expect(
      await read("select statement_id, topic_code, position, body, legal_basis, body_en, legal_basis_url, to_verify, headline from contract.rule_statement where statement_id = 'speed.rural'"),
    ).toEqual([
      { statement_id: "speed.rural", topic_code: "speed", position: 3, body: "Außerorts 100 km/h für Pkw und Krafträder.", legal_basis: "§ 3 StVO", body_en: "100 km/h for cars and motorcycles on roads outside built-up areas.", legal_basis_url: "https://www.gesetze-im-internet.de/stvo_2013/__3.html", to_verify: null, headline: false },
    ]);
    const n = await read<{ n: number; topics: number; verify: number }>(
      "select count(*)::int as n, count(distinct topic_code)::int as topics, count(to_verify)::int as verify from contract.rule_statement",
    );
    expect(n).toEqual([{ n: 74, topics: 9, verify: 24 }]);
  });

  it("message_coverage: every Land carried by the NMS relay as measured, Berlin, BW and SH by their own feeds, BW current-only", async () => {
    const r = await read<{ state_code: string; source_ref: string; coverage_role: string; current_only: boolean; measured_on: string | null }>(
      "select state_code, source_ref, coverage_role, current_only, measured_on::text as measured_on from contract.message_coverage order by 1, 2",
    );
    expect(r.filter((x) => x.coverage_role === "carried").map((x) => x.state_code)).toEqual(
      Array.from({ length: 16 }, (_, i) => String(i + 1).padStart(2, "0")),
    );
    expect(new Set(r.filter((x) => x.coverage_role === "carried").map((x) => `${x.source_ref}@${x.measured_on ?? ""}`))).toEqual(new Set(["nms_events@2026-10-21"]));
    expect(r.filter((x) => x.coverage_role === "own")).toEqual([
      { state_code: "01", source_ref: "traffic_sh", coverage_role: "own", current_only: false, measured_on: null },
      { state_code: "08", source_ref: "traffic_bw", coverage_role: "own", current_only: true, measured_on: null },
      { state_code: "11", source_ref: "traffic_lms_berlin", coverage_role: "own", current_only: false, measured_on: null },
    ]);
  });
});
