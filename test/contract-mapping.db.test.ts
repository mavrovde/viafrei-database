/**
 * The contract views read the platform's tables (0312, #29). A database
 * migrated to head is seeded with a few rows of each source table, and every
 * mapped view is read back as api_reader: its rows, the mapping of their
 * values, and the licence envelope each row carries (source_ref, display_class,
 * audience, confidentiality, terms_gate, hold_reason, origin_restriction).
 * The views' columns and types are held by api-schemas.db.test.ts.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DomainDb } from "./domain-db.js";
import { REPO } from "./helpers.js";

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
     ('truckpark_sid_static', 'mobilithek', 'SID', 'toll_collect_sid', 'Nutzungsbedingungen Toll Collect SID 1.0', 'Lkw-Stellplätze: Toll Collect', null, 3600),
     ('delfi_rt_tu', 'mobilithek', 'DELFI RT', 'delfi_rt_tu', 'CC BY-SA 4.0', 'Echtzeitdaten: DELFI', null, 60),
     ('tankerkoenig_hist', 'tankerkoenig', 'History', 'tankerkoenig_hist', 'CC BY-NC-SA 4.0', 'x', null, 86400)`,
  `insert into public.ags_regions (ags, level, name, name_norm, parent_ags, geom, source_id) values ('08111', 'kreis', 'Stuttgart', 'stuttgart', '08', ${PT(9.18, 48.78)}, 'destatis_gv')`,
  `insert into public.gazetteer_places (id, kind, name, name_norm, name_en, admin_code, rank, geom, source_id, external_id) overriding system value values
     (1, 'city', 'Stuttgart', 'stuttgart', 'Stuttgart City', '08111000', 600000, ${PT(9.18, 48.78)}, 'geonames', '2825297')`,
  `insert into public.gazetteer_places (id, kind, name, name_norm, road, source_id, external_id) overriding system value values (2, 'motorway', 'A8', 'a8', 'A8', 'autobahn', 'A8')`,
  `insert into public.gazetteer_places (id, kind, name, name_norm, road, geom, source_id, external_id) overriding system value values (5, 'junction', 'AS Stuttgart-Degerloch', 'stuttgart-degerloch', 'A8', ${PT(9.17, 48.73)}, 'autobahn', 'A8-52')`,
  `insert into public.gazetteer_places (id, kind, name, name_norm, admin_code, geom, source_id, external_id) overriding system value values
     (3, 'city', 'Leinfelden-Echterdingen', 'leinfelden-echterdingen', '08116078', ${PT(9.16, 48.7)}, 'bkg_gvisys', '08116078'),
     (4, 'city', 'Neu-Ulm', 'neu-ulm', '09775139', ${PT(10.0, 48.39)}, 'bkg_gvisys', '09775139')`,
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
     ('eq1', 'elevator', 'dhid:de:08111:6115:EdB', 'Gleis 1', now(), now(), 'openstation_netex', 'DB'),
     ('eq2', 'escalator', 'de:08111:7777', 'Ausgang Nord', now(), now(), 'kvb_fahrtreppen', 'KVB')`,
  `insert into public.db_stations (station_no, name, content_hash, first_seen_at, last_seen_at, updated_at, eva_no, eva_nos, ifopt, category, city) values
     ('1071', 'Stuttgart Hbf', 'h', now(), now(), now(), '8000096', '{8098096,8070096,8098096}', 'de:08111:6115', 1, 'Stuttgart')`,
  `insert into public.db_stations (station_no, name, content_hash, first_seen_at, last_seen_at, updated_at, ifopt, source_id) values
     ('de:08111:6115', 'Stuttgart Hbf', 'h', now(), now(), now(), 'de:08111:6115', 'delfi_static')`,
  `insert into public.station_equipment_state (equipment_id, status, state, status_since, last_seen_at, known_equipment, source_feed, source_publisher) values
     ('eq1', 'INACTIVE', 'inactive', '2026-11-15T10:00:00Z', now(), true, 'openstation_siri_fm', 'DB')`,
  `insert into public.db_facilities (equipment_no, station_no, kind, state, state_since, first_seen_at, last_seen_at, source_feed, source_publisher, description) values
     ('10500', '1071', 'escalator', 'active', '2026-11-15T10:00:00Z', now(), now(), 'db_fasta', 'DB', 'Ausgang')`,
  `insert into public.weather_warnings (id, source_feed, source_id, identifier, warncell_id, version, level, severity, event, headline, official_sha256, area_sha256, valid_from, raw) overriding system value values
     (1, 'dwd_warnings', 'dwd', 'w1', '108111000', 1, 2, 'Moderate', 'STURMBÖEN', 'Amtliche WARNUNG vor STURMBÖEN', '${HEX}', '${HEX}', now(), '{}')`,
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
  it("source: a feed with its catalogue licence, offer page and stale rule, the register's attribution, conditions and review where its licence id names a register row; SID public behind its per-request terms gate; an excluded source has no row", async () => {
    const r = await read(
      "select source_ref, domain, licence_code, attribution_text, changes_statement, terms_url, acceptance_required, use_classes, freshness_target_s, stale_after_s, review_signed_on::text as rev, register_version::text as ver, display_class, audience, terms_gate, hold_reason from contract.source where source_ref in ('delfi_rt_tu', 'mobilithek_park_x', 'truckpark_sid_static', 'tankerkoenig_hist', 'toll_collect_sid') order by 1",
    );
    expect(r).toEqual([
      { source_ref: "delfi_rt_tu", domain: "transit", licence_code: "CC BY-SA 4.0", attribution_text: "Echtzeitdaten: DELFI e.V. via Mobilithek, CC BY-SA, bearbeitet", changes_statement: "bearbeitet", terms_url: null, acceptance_required: false, use_classes: ["consumer", "non_commercial"], freshness_target_s: 60, stale_after_s: 180, rev: "2026-10-12", ver: "2026-11-14", display_class: "open", audience: "public", terms_gate: null, hold_reason: null },
      { source_ref: "mobilithek_park_x", domain: "parking", licence_code: "Datenlizenz Deutschland – Namensnennung – Version 2.0", attribution_text: "Parken: X", changes_statement: null, terms_url: "https://example.org/offer/1", acceptance_required: false, use_classes: [], freshness_target_s: 300, stale_after_s: 900, rev: null, ver: "2026-11-14", display_class: "open", audience: "public", terms_gate: null, hold_reason: null },
      { source_ref: "truckpark_sid_static", domain: "parking", licence_code: "Nutzungsbedingungen Toll Collect SID 1.0", attribution_text: "Lkw-Stellplätze: Toll Collect GmbH, Stellplatz-Informationsdienst (SID) via Mobilithek, Nutzungsbedingungen Version 1.0 (Stand 10.04.2026)", changes_statement: null, terms_url: null, acceptance_required: true, use_classes: ["consumer"], freshness_target_s: 3600, stale_after_s: 10800, rev: "2026-10-26", ver: "2026-11-14", display_class: "gated", audience: "public", terms_gate: "sid-terms-1", hold_reason: null },
    ]);
    const pub = await read<{ n: number }>("select count(*)::int as n from contract.publisher p join contract.source s on s.publisher_id = p.publisher_id");
    const src = await read<{ n: number }>("select count(*)::int as n from contract.source");
    expect(pub[0]?.n).toBe(src[0]?.n);
  });

  it("source: the register's static sources resolve with their domain, licence, use classes and review; a restricted source keeps the consumer class only; no cadence = never stale (owner 2026-11-16)", async () => {
    const r = await read(
      "select source_ref, domain, licence_code, array_to_string(use_classes, ',') as uses, acceptance_required as acc, stale_after_s, review_signed_on::text as rev, display_class, audience from contract.source where source_ref in ('geonames', 'delfi_static', 'destatis_gv_laender', 'db_fasta', 'dwd', 'viafrei_rules', 'tankerkoenig', 'mobilithek_afir_eliso_stat', 'mobilithek_park_bosch_static') order by 1",
    );
    const all = "consumer,non_commercial,commercial";
    const year3 = null;
    expect(r).toEqual([
      { source_ref: "db_fasta", domain: "accessibility", licence_code: "CC BY 4.0", uses: all, acc: false, stale_after_s: year3, rev: "2026-09-20", display_class: "open", audience: "public" },
      { source_ref: "delfi_static", domain: "transit", licence_code: "CC BY 4.0", uses: all, acc: false, stale_after_s: year3, rev: "2026-10-08", display_class: "open", audience: "public" },
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

  it("place and place_alias: a located gazetteer row, its Kreis, rank and names; a junction keeps its kind; a row with no location is not a place", async () => {
    expect(await read("select place_id, place_kind, region_code, official_key, prominence, source_ref, origin_key, source_refs, st_astext(location) as at from contract.place where source_ref <> 'bkg_gvisys' order by place_id::int")).toEqual([
      { place_id: "1", place_kind: "municipality", region_code: "08111", official_key: "08111000", prominence: 600000, source_ref: "geonames", origin_key: "2825297", source_refs: ["geonames"], at: "POINT(9.18 48.78)" },
      { place_id: "5", place_kind: "junction", region_code: null, official_key: null, prominence: 0, source_ref: "autobahn", origin_key: "A8-52", source_refs: ["autobahn"], at: "POINT(9.17 48.73)" },
    ]);
    expect(await read("select label, lang, name_kind, search_fold from contract.place_alias where place_id = '1' order by 1")).toEqual([
      { label: "Stuttgart", lang: null, name_kind: "name", search_fold: "stuttgart" },
      { label: "Stuttgart City", lang: "en", name_kind: "exonym", search_fold: "stuttgartcity" },
    ]);
  });

  it("road: the BASt LCL chains linked by pos_off_lcd, one line each, broken at a gap; a self-link, a foreign code and a lone point draw nothing; a cycle starts at its smallest code", async () => {
    const c = await db.pool.connect();
    try {
      await c.query("begin");
      const pt = (lcd: number, pos: number | null, road = "A99"): string =>
        `(58, 1, ${String(lcd)}, '22.0', 'P', 1, 1, null, null, '${road}', ${pos === null ? "null" : String(pos)}, ${PT(9 + lcd / 1000, 48)})`;
      await c.query("insert into public.autobahn_roads (road) values ('A99'), ('A98') on conflict do nothing");
      await c.query(
        `insert into public.tmc_locations (cid, tabcd, lcd, lcl_version, class, tcd, stcd, junction_no, name, road_number, pos_off_lcd, geom) values
           ${[pt(5, 3), pt(3, 9), pt(9, null), pt(7, 7), pt(11, 12), pt(12, 99), pt(99, null, "A1"), pt(20, 21, "A98"), pt(21, 22, "A98"), pt(22, 20, "A98")].join(", ")}`,
      );
      await c.query("set local role api_reader");
      const { rows: r } = await c.query<{ road_ref: string; chain: string; source_refs: string[] }>(
        `select r.road_ref, string_agg(round(((st_x(p.geom) - 9) * 1000)::numeric)::text, ',' order by p.path) as chain, r.source_refs
           from contract.road r cross join lateral st_dumppoints(r.geometry) p
          where r.road_ref in ('A99', 'A98') group by r.road_ref, p.path[1], r.source_refs order by 1, min(p.path[1])`,
      );
      expect(r).toEqual([
        { road_ref: "A98", chain: "20,21,22", source_refs: ["autobahn", "bast_lcl"] },
        { road_ref: "A99", chain: "5,3,9", source_refs: ["autobahn", "bast_lcl"] },
        { road_ref: "A99", chain: "11,12", source_refs: ["autobahn", "bast_lcl"] },
      ]);
      expect((await c.query("select road_ref, geometry, source_refs from contract.road where road_ref = 'A8'")).rows).toEqual([{ road_ref: "A8", geometry: null, source_refs: ["autobahn"] }]);
    } finally {
      await c.query("rollback");
      c.release();
    }
  });

  it("road: chains in the platform's road order (along the longest, then the first code; a spur last), their own length, and the Länder of the named junctions in road order (a spur's after its nearest main point; the nearest live keyed BKG Gemeinde within 20 km)", async () => {
    const c = await db.pool.connect();
    try {
      await c.query("begin");
      const pt = (lcd: number, pos: number | null, lon: number, lat: number, name: string | null = null, road = "A97"): string =>
        `(58, 1, ${String(lcd)}, '22.0', 'P', 1, 1, null, ${name === null ? "null" : `'${name}'`}, '${road}', ${pos === null ? "null" : String(pos)}, ${PT(lon, lat)})`;
      await c.query("insert into public.autobahn_roads (road) values ('A97'), ('A96') on conflict do nothing");
      await c.query(
        `insert into public.tmc_locations (cid, tabcd, lcd, lcl_version, class, tcd, stcd, junction_no, name, road_number, pos_off_lcd, geom) values
           ${[
             pt(30, 31, 10.0, 49, "West"), pt(31, 32, 10.01, 49, "West 2"), pt(32, null, 10.02, 49),
             pt(40, 41, 10.2, 49), pt(41, 42, 10.21, 49), pt(42, null, 10.22, 49),
             pt(10, 11, 10.4, 49), pt(11, 12, 10.41, 49, "Ost 1"), pt(12, null, 10.42, 49, " "),
             pt(5, 6, 10.207, 49.003), pt(6, null, 10.2075, 49.003, "Spur"),
             pt(50, null, 13, 52, "Fern", "A96"),
           ].join(", ")}`,
      );
      await c.query(
        `insert into public.gazetteer_places (id, kind, name, name_norm, admin_code, geom, source_id, external_id, closed_at) overriding system value values
           (101, 'city', 'G08', 'g08', '08000001', ${PT(10.0, 49.05)}, 'bkg_gvisys', 'g08', null),
           (102, 'city', 'G07', 'g07', '07000001', ${PT(10.2075, 49.003)}, 'bkg_gvisys', 'g07', null),
           (103, 'city', 'G09', 'g09', '09000001', ${PT(10.42, 49.0)}, 'bkg_gvisys', 'g09', null),
           (104, 'city', 'Geonames', 'geonames', '06000001', ${PT(10.0, 49.0)}, 'geonames', 'gn', null),
           (105, 'city', 'Short', 'short', '061', ${PT(10.0, 49.0)}, 'bkg_gvisys', 'short', null),
           (106, 'city', 'Closed', 'closed', '05000001', ${PT(10.0, 49.0)}, 'bkg_gvisys', 'closed', now()),
           (107, 'district', 'Kreis', 'kreis', '04000001', ${PT(10.0, 49.0)}, 'bkg_gvisys', 'kreis', null),
           (108, 'city', 'Far', 'far', '03000001', ${PT(13.0, 52.19)}, 'bkg_gvisys', 'far', null),
           (109, 'city', 'Unnamed', 'unnamed', '01000001', ${PT(10.22, 49.0)}, 'bkg_gvisys', 'unnamed', null)`,
      );
      await c.query("set local role api_reader");
      const { rows: chains } = await c.query<{ chain: string }>(
        `select string_agg(round(((st_x(p.geom) - 10) * 10000)::numeric)::text, ',' order by p.path) as chain
           from contract.road r cross join lateral st_dumppoints(r.geometry) p where r.road_ref = 'A97' group by p.path[1] order by p.path[1]`,
      );
      expect(chains.map((x) => x.chain)).toEqual(["0,100,200", "2000,2100,2200", "4000,4100,4200", "2070,2075"]);
      const metres = (alat: number, alon: number, blat: number, blon: number): number => {
        const rad = Math.PI / 180;
        const h = Math.sin(((blat - alat) * rad) / 2) ** 2 + Math.cos(alat * rad) * Math.cos(blat * rad) * Math.sin(((blon - alon) * rad) / 2) ** 2;
        return 2 * 6_371_008.8 * Math.asin(Math.min(1, Math.sqrt(h)));
      };
      const km = Math.round((6 * metres(49, 10, 49, 10.01) + metres(49.003, 10.207, 49.003, 10.2075)) / 100) / 10;
      expect((await c.query("select road_ref, length_km::float8 as length_km, states from contract.road where road_ref in ('A97', 'A96') order by 1")).rows).toEqual([
        { road_ref: "A96", length_km: null, states: null },
        { road_ref: "A97", length_km: km, states: ["08", "07", "09"] },
      ]);
      expect((await c.query("select junction_id, state_code, placement_source_ref from contract.junction where junction_id in ('58:1:30', '58:1:6', '58:1:11', '58:1:50') order by 1")).rows).toEqual([
        { junction_id: "58:1:11", state_code: "09", placement_source_ref: "bkg_gvisys" },
        { junction_id: "58:1:30", state_code: "08", placement_source_ref: "bkg_gvisys" },
        { junction_id: "58:1:50", state_code: null, placement_source_ref: null },
        { junction_id: "58:1:6", state_code: "07", placement_source_ref: "bkg_gvisys" },
      ]);
    } finally {
      await c.query("rollback");
      c.release();
    }
  });

  it("road: parity with the platform's motorway map on the A1, A3 and A7 of LCL 22.0, every chain point for point and in the platform's order", async () => {
    const tsv = (f: string): string[][] =>
      readFileSync(join(REPO, "test", "road-line", f), "utf8").split("\n").filter((l) => l !== "" && !l.startsWith("#")).map((l) => l.split("\t"));
    const points = tsv("lcl-points.tsv");
    const at = new Map(points.map((p) => [`${p[0] ?? ""}:${p[1] ?? ""}`, `${p[9] ?? ""} ${p[8] ?? ""}`]));
    const want = tsv("platform-chains.tsv").map(([road, lcds]) => `${road ?? ""} ${(lcds ?? "").split(",").map((l) => at.get(`${road ?? ""}:${l}`) ?? "?").join(";")}`);
    const c = await db.pool.connect();
    try {
      await c.query("begin");
      await c.query("insert into public.autobahn_roads (road) values ('A1'), ('A3'), ('A7') on conflict do nothing");
      for (const p of points) {
        await c.query(
          `insert into public.tmc_locations (cid, tabcd, lcd, lcl_version, class, tcd, stcd, junction_no, name, road_number, neg_off_lcd, pos_off_lcd, geom)
           values (58, 1, $1, '22.0', 'P', $2, $3, nullif($4, ''), nullif($5, ''), $6, nullif($7, '')::integer, nullif($8, '')::integer, st_setsrid(st_makepoint($10, $9), 4326)::geography)`,
          [p[1], p[2], p[3], p[4], p[5], p[0], p[6], p[7], p[8], p[9]],
        );
      }
      await c.query("set local role api_reader");
      const t0 = Date.now();
      const r = await c.query<{ chain: string }>(
        `select r.road_ref || ' ' || string_agg(st_x(p.geom)::text || ' ' || st_y(p.geom)::text, ';' order by p.path) as chain
           from contract.road r cross join lateral st_dumppoints(r.geometry) p
          where r.road_ref in ('A1', 'A3', 'A7') group by r.road_ref, p.path[1] order by r.road_ref, p.path[1]`,
      );
      expect(Date.now() - t0).toBeLessThan(2000);
      expect(r.rows.map((x) => x.chain)).toEqual(want);
      expect(want).toHaveLength(4);
    } finally {
      await c.query("rollback");
      c.release();
    }
  });

  it("road and junction: the A-road list (Autobahn API: public, owner 2026-11-16) and its TMC junctions only", async () => {
    expect(await read("select road_ref, road_class, states, source_ref, display_class, audience from contract.road")).toEqual([
      { road_ref: "A8", road_class: "motorway", states: ["08"], source_ref: "autobahn", display_class: "open", audience: "public" },
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
      { event_id: "autobahn:X1", event_kind: "roadworks", road_class: "motorway", headline: "A8 | Stuttgart", description: "Zeile 1\nZeile 2", is_blocked: true, from_payload: true, record_class: "operator_event", source_ref: "autobahn", display_class: "open", audience: "public", confidentiality: null, origin_restriction: null },
      { event_id: "datex:DE-BW:S2", event_kind: "accident", road_class: "federal", headline: "Accident", description: null, is_blocked: null, from_payload: false, record_class: "traffic_message", source_ref: "mobilithek_traffic_bw", display_class: "withhold", audience: "own", confidentiality: "restrictedToAuthorities", origin_restriction: "bw_rvwd" },
      { event_id: "datex:DE-MIA:S1", event_kind: "roadworks", road_class: "motorway", headline: "MaintenanceWorks", description: null, is_blocked: null, from_payload: false, record_class: "traffic_message", source_ref: "mobilithek_bab_messages", display_class: "open", audience: "public", confidentiality: null, origin_restriction: null },
    ]);
  });

  it("traffic_event_observation: every Autobahn tick and the ticks of events we did not retract", async () => {
    expect(await read("select event_id, version_no, display_class from contract.traffic_event_observation order by 1, observed_at")).toEqual([
      { event_id: "autobahn:X0", version_no: null, display_class: "open" },
      { event_id: "autobahn:X1", version_no: null, display_class: "open" },
      { event_id: "autobahn:X1", version_no: null, display_class: "open" },
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
      { point_id: "DE*ABC*E1", site_id: "afir_enbw_stat:s1", evse_code: "DE*ABC*E1", current_kind: "ac", kw: "22.00", source_ref: "afir_enbw_stat" },
    ]);
    expect(await read("select point_id, availability, source_ref, display_class from contract.charge_point_state_observation")).toEqual([
      { point_id: "DE*ABC*E1", availability: "occupied", source_ref: "afir_enbw_dyn", display_class: "open" },
    ]);
  });
});

describe("parking", () => {
  it("parking_facility and occupancy: a plain facility open; a SID facility and its figure public behind the per-request terms gate", async () => {
    expect(await read("select facility_id, parking_kind, operator_name, acceptance_required, source_ref, display_class, audience, terms_gate, hold_reason from contract.parking_facility order by 1")).toEqual([
      { facility_id: "p:11", parking_kind: "park_and_ride", operator_name: "Stadt", acceptance_required: false, source_ref: "mobilithek_park_x", display_class: "open", audience: "public", terms_gate: null, hold_reason: null },
      { facility_id: "sid:12", parking_kind: "truck_parking", operator_name: null, acceptance_required: true, source_ref: "truckpark_sid_static", display_class: "gated", audience: "public", terms_gate: "sid-terms-1", hold_reason: null },
    ]);
    expect(await read("select facility_id, free_spaces, total_spaces, occupancy_status, display_class, audience, terms_gate, hold_reason from contract.occupancy_observation order by 1")).toEqual([
      { facility_id: "p:11", free_spaces: 10, total_spaces: 100, occupancy_status: "free", display_class: "open", audience: "public", terms_gate: null, hold_reason: null },
      { facility_id: "sid:12", free_spaces: 5, total_spaces: 40, occupancy_status: "filling", display_class: "gated", audience: "public", terms_gate: "sid-terms-1", hold_reason: null },
    ]);
  });
});

describe("transit", () => {
  it("stop_place, stop_point and transit_line from the static GTFS", async () => {
    expect(await read("select stop_place_id, national_stop_code, region_code, modes, search_fold, source_ref from contract.stop_place")).toEqual([
      { stop_place_id: "1:de:08111:6115", national_stop_code: "de:08111:6115", region_code: "08111", modes: ["sbahn"], search_fold: "stuttgarthbf", source_ref: "delfi_static" },
    ]);
    expect(await read("select station_category, municipality_name, eva_no, eva_numbers, ifopt from contract.stop_place")).toEqual([
      { station_category: 1, municipality_name: "Stuttgart", eva_no: "8000096", eva_numbers: ["8000096", "8098096", "8070096"], ifopt: "de:08111:6115" },
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

  it("scheduled_call and departure on the two clock-change Sundays: GTFS times count from noon minus twelve hours, not from midnight", async () => {
    // On 2026-03-29 and 2026-10-25 Berlin midnight and noon lie on different UTC offsets:
    // counted from midnight, 08:00 would read 09:00 in March and 07:00 in October.
    const c = await db.pool.connect();
    try {
      await c.query("begin");
      await c.query("insert into public.gtfs_service_dates (service_date, gtfs_feed_key, service_id) values ('2026-03-29', 1, 'svc1'), ('2026-10-25', 1, 'svc1')");
      await c.query("set local role api_reader");
      const times = async (view: string): Promise<{ day: string; call_order: number; arr: string; dep: string }[]> =>
        (
          await c.query<{ day: string; call_order: number; arr: string; dep: string }>(
            `select right(journey_id, 8) as day, call_order,
                    to_char(planned_arrival_at at time zone 'Europe/Berlin', 'YYYY-MM-DD HH24:MI') as arr,
                    to_char(planned_departure_at at time zone 'Europe/Berlin', 'YYYY-MM-DD HH24:MI') as dep
               from contract.${view}
              where journey_id in ('1:t1:20260329', '1:t1:20261025') order by 1, 2`,
          )
        ).rows;
      const want = [
        { day: "20260329", call_order: 1, arr: "2026-03-29 08:00", dep: "2026-03-29 08:01" },
        { day: "20260329", call_order: 2, arr: "2026-03-30 01:10", dep: "2026-03-30 01:10" },
        { day: "20261025", call_order: 1, arr: "2026-10-25 08:00", dep: "2026-10-25 08:01" },
        { day: "20261025", call_order: 2, arr: "2026-10-26 01:10", dep: "2026-10-26 01:10" },
      ];
      expect(await times("scheduled_call")).toEqual(want);
      expect(await times("departure")).toEqual(want);
    } finally {
      await c.query("rollback");
      c.release();
    }
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
      { facility_id: "equipment:eq2", stop_place_id: null, facility_kind: "escalator", position_text: "Ausgang Nord", facility_status: "unknown", source_ref: "kvb_fahrtreppen" },
      { facility_id: "fasta:10500", stop_place_id: "1:de:08111:6115", facility_kind: "escalator", position_text: "Ausgang", facility_status: "active", source_ref: "db_fasta" },
    ]);
  });

  it("weather_warning: hazard, level, the Kreis of the warn cell, the DWD as issuer", async () => {
    expect(await read("select warning_id, hazard, warning_level, level_label, message_status, issuer_name, region_code, source_ref from contract.weather_warning")).toEqual([
      { warning_id: "dwd:1", hazard: "wind", warning_level: 2, level_label: "Moderate", message_status: "actual", issuer_name: "Deutscher Wetterdienst", region_code: "08111", source_ref: "dwd_warnings" },
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

describe("0312 additions (owner decisions 2026-11-16)", () => {
  it("terms: sid-terms-1 in German (binding) and English, the verbatim section A.2, and every SID row's terms_gate names it", async () => {
    const t = await read<{ terms_gate: string; terms_id: string; terms_version: string; lang: string; binding: boolean; terms_url: string; head: boolean; body: boolean; audience: string }>(
      "select terms_gate, terms_id, terms_version, lang, binding, terms_url, heading <> '' as head, body like '%Toll Collect GmbH, Stellplatz-Informationsdienst (SID) via Mobilithek%' as body, audience from contract.terms order by lang",
    );
    expect(t).toEqual([
      { terms_gate: "sid-terms-1", terms_id: "sid-terms", terms_version: "1", lang: "de", binding: true, terms_url: "https://viafrei.de/terms#sid", head: true, body: true, audience: "public" },
      { terms_gate: "sid-terms-1", terms_id: "sid-terms", terms_version: "1", lang: "en", binding: false, terms_url: "https://viafrei.de/en/terms#sid", head: true, body: true, audience: "public" },
    ]);
    const gates = await read<{ g: string | null }>(
      "select distinct terms_gate as g from contract.parking_facility where source_ref ~ 'sid' union select distinct terms_gate from contract.occupancy_observation where source_ref ~ 'sid' union select distinct terms_gate from contract.source where source_ref ~ 'sid'",
    );
    expect(gates).toEqual([{ g: "sid-terms-1" }]);
  });

  it("licence: every label a source names has a URL; the licence texts are listed with theirs", async () => {
    const missing = await read<{ c: string }>("select l.licence_code as c from contract.licence l where l.licence_url is null");
    expect(missing).toEqual([]);
    const sid = await read<{ licence_url: string; licence_category: string }>("select licence_url, licence_category from contract.licence where licence_code = 'Nutzungsbedingungen Toll Collect SID 1.0'");
    expect(sid).toHaveLength(1);
    const odbl = await read<{ licence_url: string; share_alike: boolean }>("select licence_url, share_alike from contract.licence where licence_code = 'Open Database License 1.0'");
    expect(odbl).toEqual([{ licence_url: "https://opendatacommons.org/licenses/odbl/1-0/", share_alike: true }]);
  });

  it("publisher website and share_alike_offer_url: the catalogue's offer page; a share-alike source offers the changed data", async () => {
    const r = await read<{ source_ref: string; share_alike_offer_url: string | null }>(
      "select source_ref, share_alike_offer_url from contract.source where source_ref in ('delfi_rt_tu', 'mobilithek_park_x') order by 1",
    );
    expect(r).toEqual([
      { source_ref: "delfi_rt_tu", share_alike_offer_url: "https://viafrei.de/impressum" },
      { source_ref: "mobilithek_park_x", share_alike_offer_url: null },
    ]);
    const w = await read<{ website: string | null }>("select website from contract.publisher where publisher_id = (select publisher_id from contract.source where source_ref = 'mobilithek_park_x')");
    expect(w).toEqual([{ website: "https://example.org/offer/1" }]);
  });

  it("junction state_code: the Land of the nearest BKG municipality, placed by bkg_gvisys", async () => {
    const r = await read<{ junction_id: string; state_code: string | null; placement_source_ref: string | null }>(
      "select junction_id, state_code, placement_source_ref from contract.junction order by 1",
    );
    expect(r).toEqual([{ junction_id: "58:1:1000", state_code: "08", placement_source_ref: "bkg_gvisys" }]);
  });

  it("placement_source_ref: a traffic event or stop placed in a Land or Kreis names bkg_gvisys, an unplaced one null", async () => {
    for (const [view, code] of [["traffic_event", "state_code"], ["stop_place", "region_code"]] as const) {
      const r = await read<{ placed: number; wrong: number }>(
        `select count(*) filter (where ${code} is not null)::int as placed,
                count(*) filter (where placement_source_ref is distinct from case when ${code} is not null then 'bkg_gvisys' end)::int as wrong
           from contract.${view}`,
      );
      expect(r[0]?.wrong).toBe(0);
      expect(r[0]?.placed).toBeGreaterThan(0);
    }
  });

  it("traffic_event: the newest sweep per road and kind is kept by the insert; a newer sweep replaces the last, a late older tick does not, and kinds that are no traffic event stay out", async () => {
    const c = await db.pool.connect();
    const ids = async (): Promise<string[]> => (await c.query<{ e: string }>("select event_id as e from contract.traffic_event where event_id like 'autobahn:%' order by 1")).rows.map((x) => x.e);
    try {
      await c.query("begin");
      expect(await ids()).toEqual(["autobahn:X1"]);
      const sweep = async (at: string, kind: string, id: string): Promise<void> => {
        await c.query(`insert into public.autobahn_events (observed_at, road, kind, ext_id, title, geom, source) values (${at}, 'A8', '${kind}', '${id}', 't', ${PT(9.17, 48.73)}, 'autobahn')`);
      };
      await sweep(`(${T0} + interval '2 seconds')`, "roadworks", "X2");
      expect(await ids()).toEqual(["autobahn:X2"]);
      await sweep(T0, "roadworks", "X9");
      expect(await ids()).toEqual(["autobahn:X2"]);
      const s = await c.query<{ n: string }>("select count(*)::text as n from public.autobahn_sweeps where road = 'A8' and kind = 'roadworks' and observed_at = " + `${T0} + interval '2 seconds'`);
      expect(s.rows[0]?.n).toBe("1");
      await sweep(T1, "closure_entry_exit", "C1");
      await sweep(T1, "parking_lorry", "L1");
      await sweep(T1, "electric_charging_station", "E1");
      expect(await ids()).toEqual(["autobahn:C1", "autobahn:X2"]);
      const kind = await c.query<{ k: string }>("select event_kind as k from contract.traffic_event where event_id = 'autobahn:C1'");
      expect(kind.rows).toEqual([{ k: "closure" }]);
    } finally {
      await c.query("rollback");
      c.release();
    }
  });
});

describe("traffic_event: the platform's kind and ranking band on the API's severity scale (#29)", () => {
  it("severity: a closed or blocked road, an accident, a long jam, roadworks, a short jam, a restriction, a hazard; a lane deviation is no closure", async () => {
    const c = await db.pool.connect();
    try {
      await c.query("begin");
      await c.query("delete from public.autobahn_sweeps");
      const ab = async (kind: string, id: string, extra: { type?: string; delay?: number; blocked?: boolean } = {}): Promise<void> => {
        await c.query(
          `insert into public.autobahn_events (observed_at, road, kind, ext_id, title, geom, source, abnormal_traffic_type, delay_s, raw, raw_hash)
           values (now(), 'A8', '${kind}', '${id}', 't', ${PT(9.17, 48.73)}, 'autobahn', ${extra.type === undefined ? "null" : `'${extra.type}'`},
                   ${extra.delay === undefined ? "null" : String(extra.delay)}, '{"isBlocked": "${String(extra.blocked ?? false)}"}'::jsonb, decode(md5('${id}'), 'hex'))`,
        );
      };
      await ab("closure", "S1");
      await ab("closure_entry_exit", "S2");
      await ab("roadworks", "S3");
      await ab("roadworks", "S4", { blocked: true });
      await ab("warning", "S5", { type: "QUEUING_TRAFFIC", delay: 600 });
      await ab("warning", "S6", { type: "SLOW_TRAFFIC", delay: 540 });
      await ab("warning", "S7");
      await ab("warning", "S8", { type: "UNKNOWN_TRAFFIC", delay: 900 });
      const dx = async (id: string, type: string): Promise<void> => {
        await c.query(
          `insert into public.road_events (id, feed_key, source_id, publication_id, version, payload, event_type, road_number, geom, source_feed) overriding system value
           values (${String(900 + Number(id.slice(1)))}, 'mobilithek_bab_messages', 'DE-SEV', '${id}', 1, '{}', '${type}', 'A8', st_setsrid(st_makepoint(9.17, 48.73), 4326), 'mobilithek_bab_messages')`,
        );
      };
      await dx("D1", "roadOrCarriagewayOrLaneManagement");
      await dx("D2", "accident");
      await dx("D3", "Straßensperrung");
      await dx("D4", "Unfall");
      await dx("D5", "abnormalTraffic");
      await dx("D6", "vehicleObstruction");
      await dx("D7", "publicEvent");
      const r = await c.query<{ id: string; kind: string; sev: string }>(
        "select event_id as id, event_kind as kind, severity as sev from contract.traffic_event where event_id ~ '^(autobahn:S|datex:DE-SEV:)' order by 1",
      );
      expect(r.rows.map((x) => `${x.id} ${x.kind} ${x.sev}`)).toEqual([
        "autobahn:S1 closure road_closed",
        "autobahn:S2 closure major",
        "autobahn:S3 roadworks lane_closed",
        "autobahn:S4 roadworks road_closed",
        "autobahn:S5 jam major",
        "autobahn:S6 jam minor",
        "autobahn:S7 hazard info",
        "autobahn:S8 hazard info",
        "datex:DE-SEV:D1 restriction minor",
        "datex:DE-SEV:D2 accident major",
        "datex:DE-SEV:D3 closure road_closed",
        "datex:DE-SEV:D4 accident major",
        "datex:DE-SEV:D5 jam minor",
        "datex:DE-SEV:D6 hazard info",
        "datex:DE-SEV:D7 other other",
      ]);
    } finally {
      await c.query("rollback");
      c.release();
    }
  });

  it("domain: station equipment and stop accessibility sources answer for accessibility, the timetable for transit", async () => {
    const { rows: r } = await db.pool.query<{ k: string; d: string }>(
      `select k, (select d.domain from public.contract_source_domains d where k ~ d.pattern order by d.priority limit 1) as d
         from unnest(array['db_fasta', 'kvb_aufzugsstoerung', 'openstation_netex', 'openstation_siri_fm', 'bfrk_spnv', 'delfi_rt_tu', 'db_ris_stations']) k order by 1`,
    );
    expect(r.map((x) => `${x.k} ${x.d}`)).toEqual([
      "bfrk_spnv accessibility",
      "db_fasta accessibility",
      "db_ris_stations transit",
      "delfi_rt_tu transit",
      "kvb_aufzugsstoerung accessibility",
      "openstation_netex accessibility",
      "openstation_siri_fm accessibility",
    ]);
  });
});

describe("search_fold and the stop place lookups (#29)", () => {
  it("search_fold: lower case, umlauts and ß spelled out, other diacritics dropped, letters and digits only", async () => {
    const r = await read<{ a: string; b: string; c: string; d: string; e: string; f: string }>(
      `select public.contract_search_fold('Köln Hbf') as a, public.contract_search_fold('koeln hbf') as b, public.contract_search_fold('KÖLN-HBF') as c,
              public.contract_search_fold('Straße Ärzte Übach') as d, public.contract_search_fold('Gießen (Lahn) Bf 2') as e, public.contract_search_fold('Besançon Saint-Étienne Łódź') as f`,
    );
    expect(r).toEqual([{ a: "koelnhbf", b: "koelnhbf", c: "koelnhbf", d: "strasseaerzteuebach", e: "giessenlahnbf2", f: "besanconsaintetiennelodz" }]);
  });

  it("stop_place: a stop no DB station names keeps its own DHID and takes the nearest municipality's name", async () => {
    const c = await db.pool.connect();
    try {
      await c.query("begin");
      await c.query(`insert into public.stops (gtfs_feed_key, id, name, geom, location_type) values (1, 'de:08116:4400', 'Echterdingen Bahnhof', ${PT(9.161, 48.701)}, 1)`);
      const r = await c.query("select station_category, municipality_name, eva_no, eva_numbers, ifopt, search_fold from contract.stop_place where stop_place_id = '1:de:08116:4400'");
      expect(r.rows).toEqual([{ station_category: null, municipality_name: "Leinfelden-Echterdingen", eva_no: null, eva_numbers: [], ifopt: "de:08116:4400", search_fold: "echterdingenbahnhof" }]);
    } finally {
      await c.query("rollback");
      c.release();
    }
  });

  it("station_facility: a KVB Haltestelle DELFI keeps no parent for maps to its first parentless stop", async () => {
    const c = await db.pool.connect();
    try {
      await c.query("begin");
      await c.query(`insert into public.stops (gtfs_feed_key, id, name, geom, location_type) values
        (1, 'de:08111:7777:2:2', 'Nord', ${PT(9.2, 48.8)}, 0), (1, 'de:08111:7777:1:1', 'Nord', ${PT(9.2, 48.8)}, 0)`);
      const r = await c.query("select stop_place_id from contract.station_facility where facility_id = 'equipment:eq2'");
      expect(r.rows).toEqual([{ stop_place_id: "1:de:08111:7777:1:1" }]);
    } finally {
      await c.query("rollback");
      c.release();
    }
  });

  it("station_facility: the stop place lookup reads the stops under the DHID through the id-prefix index, not every stop (#49)", async () => {
    const c = await db.pool.connect();
    const tuples = "select s.seq_tup_read + coalesce(s.idx_tup_fetch, 0) as n from pg_stat_xact_user_tables s where s.relid = 'public.stops'::regclass";
    try {
      await c.query("begin");
      await c.query(`insert into public.stops (gtfs_feed_key, id, name, geom, location_type)
        select 1, 'de:08111:' || (8000 + g) || ':1:1', 'Andere', ${PT(9.2, 48.8)}, 0 from generate_series(1, 1000) g`);
      await c.query(`insert into public.stops (gtfs_feed_key, id, name, geom, location_type) values (1, 'de:08111:7777:1:1', 'Nord', ${PT(9.2, 48.8)}, 0)`);
      // Either end of the range [DHID':', DHID';'): a longer number sharing the DHID's digits (below ':'), and an id
      // past the colon (';' and above) are no stop of the DHID.
      await c.query(`insert into public.stops (gtfs_feed_key, id, name, geom, location_type) values
        (1, 'de:08111:77771:1:1', 'Nachbar', ${PT(9.2, 48.8)}, 0), (1, 'de:08111:77791:1:1', 'Nachbar', ${PT(9.2, 48.8)}, 0),
        (1, 'de:08111:7778;1', 'Daneben', ${PT(9.2, 48.8)}, 0)`);
      // With its statistics (rolled back with the rest), the planner costs a full read of stops as what it is.
      await c.query("analyze public.stops");
      const before = Number((await c.query<{ n: string }>(tuples)).rows[0]?.n ?? 0);
      const r = await c.query("select public.contract_stop_place_of('dhid:de:08111:7777:EdB') as id");
      const after = Number((await c.query<{ n: string }>(tuples)).rows[0]?.n ?? 0);
      expect(r.rows).toEqual([{ id: "1:de:08111:7777:1:1" }]);
      expect(after - before).toBeLessThan(5);
      const ends = await c.query("select public.contract_stop_place_of('de:08111:7779') as below, public.contract_stop_place_of('de:08111:7778') as above");
      expect(ends.rows).toEqual([{ below: null, above: null }]);
      // A security definer: only the contract's reader runs it, not PUBLIC.
      const may = await c.query(
        "select has_function_privilege('api_reader', 'public.contract_stop_place_of(text)', 'execute') as reader, has_function_privilege('viafrei_mcp', 'public.contract_stop_place_of(text)', 'execute') as other",
      );
      expect(may.rows).toEqual([{ reader: true, other: false }]);
    } finally {
      await c.query("rollback");
      c.release();
    }
  });

  it("road: a read of no shape column draws no shape, and a read of one road draws that road's alone (#49)", async () => {
    const plan = async (sql: string): Promise<string> => (await read<{ "QUERY PLAN": string }>(`explain (costs off) ${sql}`)).map((x) => x["QUERY PLAN"]).join("\n");
    expect(await plan("select road_ref, road_class, name, source_ref, display_class, audience from contract.road")).not.toContain("contract_road_shape");
    const one = await plan("select geometry from contract.road where road_ref = 'A8'");
    expect(one).toContain("Function Scan on contract_road_shape");
    expect(one).toMatch(/on autobahn_roads s\n.*\(road = 'A8'::text\)/);
  });
});

describe("departure (#29): the platform's live departure, one figure from one feed", () => {
  // A departure planned 30 minutes from now at Stuttgart Hbf platform 1, line S1, then a later stop; a feed is up
  // when its catalogue row has a fresh success. Each case runs in a transaction it rolls back.
  const DEP = `((now() + interval '30 minutes') - ((${TODAY} + time '12:00') at time zone 'Europe/Berlin' - interval '12 hours'))`;
  const PLAN = [
    `insert into public.trips (gtfs_feed_key, id, route_id, service_id, headsign, trip_short_name) values (1, 'd1', 'r1', 'svc1', 'Herrenberg', '7123')`,
    `insert into public.stop_times (gtfs_feed_key, trip_id, stop_sequence, stop_id, arrival, departure) values
       (1, 'd1', 1, 'de:08111:9000:1', ${DEP} - interval '10 minutes', ${DEP} - interval '10 minutes'),
       (1, 'd1', 2, 'de:08111:6115:1:1', ${DEP}, ${DEP}), (1, 'd1', 3, 'de:08111:9001:1', ${DEP} + interval '9 minutes', ${DEP} + interval '9 minutes')`,
  ];
  const UP = (feed: string): string[] => [
    `insert into public.feed_catalog (feed_key, provider, display_name, licence_id, cadence_s) values ('${feed}', 'delfi', '${feed}', 'cc-by-sa', 120) on conflict do nothing`,
    `insert into control.feed_state (ledger, key, last_success_at, updated_at) values ('feed', '${feed}', now(), now()) on conflict (ledger, key) do update set last_success_at = now()`,
  ];
  const TU = (seq: number | null, rel: string, delay: number | null): string =>
    `insert into public.transit_delays (observed_at, feed_ts, trip_id, stop_sequence, delay_s, schedule_relationship, source) values (now(), now(), 'd1', ${seq === null ? "null" : String(seq)}, ${delay === null ? "null" : String(delay)}, '${rel}', 'delfi_rt_tu')`;
  const SIRI = (ref: string, o: { platform?: string; delayMin?: number; cancelled?: boolean; destination?: string; line?: string; feed?: string }): string => {
    const at = `((${TODAY} + time '12:00') at time zone 'Europe/Berlin' - interval '12 hours' + ${DEP})`;
    return `insert into public.delfi_siri_et_calls_latest (stop_ref, service_day, journey_ref, visit, source_feed, observed_at, line, category, destination, platform, aimed_dep, expected_dep, delay_s, recorded, cancelled, journey_cancelled)
      values ('${ref}', ${TODAY}, 'j-${ref}', 1, '${o.feed ?? "delfi_siri_et"}', now(), '${o.line ?? "S 1"}', 'S', '${o.destination ?? "Herrenberg"}', ${o.platform === undefined ? "null" : `'${o.platform}'`},
              ${at}, ${at} + interval '${String(o.delayMin ?? 0)} minutes', null, false, ${String(o.cancelled ?? false)}, false)`;
  };
  type Dep = {
    stop_place_id: string; line_name: string; transport_mode: string; train_number: string | null; train_category: string | null; destination_label: string;
    planned_platform: string | null; platform: string | null; platform_changed: boolean; boarding: boolean; terminates: boolean; realtime: boolean;
    realtime_source: string | null; cancelled: boolean; delay_s: number | null; delay_min: number | null; mins: number | null; no_forecast: boolean; source_refs: string[];
  };
  const board = async (setup: readonly string[]): Promise<Dep[]> => {
    const c = await db.pool.connect();
    try {
      await c.query("begin");
      for (const q of [...PLAN, ...setup]) await c.query(q);
      const r = await c.query<Dep>(
        `select stop_place_id, line_name, transport_mode, train_number, train_category, destination_label, planned_platform, platform, platform_changed, boarding, terminates,
                realtime, realtime_source, cancelled, delay_s, delay_min,
                round(extract(epoch from expected_departure_at - planned_departure_at) / 60)::int as mins, no_forecast, source_refs
           from contract.departure where stop_point_id = '1:de:08111:6115:1:1' and journey_id like '1:d1:%'`,
      );
      return r.rows;
    } finally {
      await c.query("rollback");
      c.release();
    }
  };
  const BASE = { stop_place_id: "1:de:08111:6115", line_name: "S1", transport_mode: "sbahn", train_number: "7123", destination_label: "Herrenberg", planned_platform: "1", boarding: true, terminates: false };

  it("departure: with no feed up, the timetable's call, its line and mode, says no figure", async () => {
    expect(await board([TU(2, "SCHEDULED", 300)])).toEqual([
      { ...BASE, train_category: null, platform: "1", platform_changed: false, realtime: false, realtime_source: null, cancelled: false, delay_s: null, delay_min: null, mins: null, no_forecast: false, source_refs: ["delfi_static"] },
    ]);
  });

  it("departure: Trip Updates, the newest row of the latest earlier stop when the stop has none; SKIPPED here or a newer CANCELED trip cancels", async () => {
    const live = { ...BASE, train_category: null, platform: "1", platform_changed: false, realtime: true, realtime_source: "delfi_rt_tu", no_forecast: false, source_refs: ["delfi_static", "delfi_rt_tu"] };
    expect(await board([...UP("tripupdates"), TU(1, "SCHEDULED", 240)])).toEqual([{ ...live, cancelled: false, delay_s: 240, delay_min: 4, mins: 4 }]);
    expect(await board([...UP("tripupdates"), TU(1, "SCHEDULED", 240), TU(2, "SKIPPED", null)])).toEqual([{ ...live, cancelled: true, delay_s: null, delay_min: null, mins: null }]);
    expect(await board([...UP("tripupdates"), TU(1, "SCHEDULED", 240), TU(null, "CANCELED", null)])).toEqual([{ ...live, cancelled: true, delay_s: null, delay_min: null, mins: null }]);
    expect(await board([...UP("tripupdates"), TU(2, "NO_DATA", 120), TU(1, "SCHEDULED", 240)])).toEqual([
      { ...live, realtime: false, realtime_source: null, cancelled: false, delay_s: null, delay_min: null, mins: null },
    ]);
  });

  it("departure: a SIRI ET call of the line in the minute wins over Trip Updates, with its platform change; every carrier is credited", async () => {
    const r = await board([...UP("tripupdates"), ...UP("delfi_siri_et"), TU(1, "SCHEDULED", 240), SIRI("de:08111:6115", { platform: "3", delayMin: 7 })]);
    expect(r).toEqual([
      { ...BASE, train_category: "S", platform: "3", platform_changed: true, realtime: true, realtime_source: "delfi_siri_et", cancelled: false, delay_s: 420, delay_min: 7, mins: 7, no_forecast: false, source_refs: ["delfi_static", "delfi_rt_tu", "delfi_siri_et"] },
    ]);
    const cancelled = await board([...UP("delfi_siri_et"), SIRI("de:08111:6115", { cancelled: true })]);
    expect(cancelled.map((d) => [d.cancelled, d.realtime_source])).toEqual([[true, "delfi_siri_et"]]);
  });

  it("departure: a SIRI ET call is the departure's only by its line, through the EVA bridge only naming the same end, and only while its feed is up", async () => {
    const pairs = `insert into public.delfi_siri_et_stop_pairs (eva, dhid, station_dhid, matches, first_seen_at, confirmed_at) values ('8000096', 'de:08111:6115:1:1', 'de:08111:6115', 1, now(), now())`;
    const src = async (setup: string[]): Promise<(string | null)[]> => (await board(setup)).map((d) => d.realtime_source);
    expect(await src([...UP("delfi_siri_et"), pairs, SIRI("8000096", {})])).toEqual(["delfi_siri_et"]);
    expect(await src([...UP("delfi_siri_et"), pairs, SIRI("8000096", { destination: "Schorndorf" })])).toEqual([null]);
    expect(await src([...UP("delfi_siri_et"), SIRI("de:08111:6115", { line: "S2" })])).toEqual([null]);
    expect(await src([SIRI("de:08111:6115", {})])).toEqual([null]);
    // the DB station's EVA number (db_stations 1071 names 8000096) is a ref of its own
    expect(await src([...UP("delfi_siri_et"), "update public.db_stations set eva_nos = '{8000096}' where station_no = '1071'", SIRI("8000096", { destination: "Schorndorf" })])).toEqual(["delfi_siri_et"]);
  });

  it("departure: a delay beyond six hours is no figure, and the board says so", async () => {
    const r = await board([...UP("tripupdates"), TU(2, "SCHEDULED", 7 * 3600)]);
    expect(r.map((d) => [d.realtime, d.delay_s, d.no_forecast, d.source_refs])).toEqual([[false, null, true, ["delfi_static", "delfi_rt_tu"]]]);
  });
});
