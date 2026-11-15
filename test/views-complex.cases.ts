/**
 * The joined and aggregating views (#32): each one is read over a small
 * planted world in which every row but the ones the view is for fails exactly
 * one of its conditions. test/views-complex.db.test.ts seeds `seed` (columns
 * not named are filled by type, CHECKs dropped, triggers off) and compares
 * `query` with `expect`; scripts/mutants-schema-behaviour.ts breaks each
 * `mutants` snippet of the view's block in the baseline, and each must change
 * the answer.
 *
 * Values are SQL expressions.
 */
export type Seed = readonly [table: string, set: Readonly<Record<string, string>>];

export type ComplexCase = {
  readonly view: string;
  /** SQL run first, as the owner (a partition for a tick table). */
  readonly before?: readonly string[];
  readonly seed: readonly Seed[];
  /** Materialized views refreshed after the seed, in order. */
  readonly refresh?: readonly string[];
  readonly query: string;
  readonly expect: readonly Readonly<Record<string, unknown>>[];
  /** [what it breaks, snippet once in the view's block, its replacement]. */
  readonly mutants: readonly (readonly [string, string, string])[];
};

const T = (min: number): string => `timestamptz '2026-11-15 12:00Z' + interval '${String(min)} minutes'`;
const AGO = (min: number): string => `now() - interval '${String(min)} minutes'`;
const q = (s: string): string => `'${s.replace(/'/g, "''")}'`;
const PT = (x: number, y: number): string => `'SRID=4326;POINT(${String(x)} ${String(y)})'`;
const LINE = (x: number, y: number): string => `'SRID=25832;LINESTRING(${String(x)} ${String(y)}, ${String(x + 100)} ${String(y)})'`;
const TODAY = "(now() at time zone 'UTC')::date";
/** The UTC-day partitions of transit_delays the planted ticks fall in, where no partition (of any name or bounds) holds that day yet. */
const TD_PART = `do $$ declare d date; begin
  for d in select distinct (x at time zone 'UTC')::date from unnest(array[now() - interval '1 hour', now() + interval '10 minutes']) x loop
    begin
      execute format('create table public.%I partition of public.transit_delays for values from (%L) to (%L)',
                     'transit_delays_vc_' || to_char(d, 'YYYYMMDD'), d::timestamp at time zone 'UTC', (d + 1)::timestamp at time zone 'UTC');
    exception when invalid_object_definition then null; -- a partition already holds that day
    end;
  end loop;
end $$`;

const losSite = (id: string, set: Record<string, string> = {}): Seed => ["public.los_sites", { site_id: q(id), carriageway: "'hfb'", road: "'A1'", geom: PT(7, 51), ...set }];
/** Sites <p>1..<p>6: one the live views show, then one closed, off the main carriageway, with no road, with no place, restricted. */
const losSites = (p: string): Seed[] => [{}, { closed_at: "now()" }, { carriageway: "'nfb'" }, { road: "null" }, { geom: "null" }, { confidentiality: "'restrictedToAuthorities'" }].map((set, i) => losSite(`${p}${String(i + 1)}`, set));
const delay = (trip: string, stop: string, min: number, d: string, set: Record<string, string> = {}): Seed =>
  ["public.transit_delays", { trip_id: q(trip), stop_id: q(stop), observed_at: AGO(min), feed_ts: AGO(min), delay_s: d, source: "'delfi_rt_tu'", ...set }];
const untimed = (trip: string): Seed[] => [
  ["public.stop_times", { gtfs_feed_key: "1", trip_id: q(trip), stop_sequence: "1", stop_id: "'u1'", departure: "'10:00'" }],
  ["public.stop_times", { gtfs_feed_key: "1", trip_id: q(trip), stop_sequence: "2", stop_id: "'u2'", departure: "'10:00'" }],
];
const odbl = (set: Record<string, string>): Record<string, string> => ({ source_id: "'s'", feed_version: "'v'", ...set });

export const COMPLEX_CASES: readonly ComplexCase[] = [
  {
    view: "public.city_traffic_now_live",
    seed: [
      ["public.city_traffic_segments", { id: "1" }],
      ["public.city_traffic_segments", { id: "2" }],
      ["public.city_traffic_segments", { id: "3" }],
      ["public.city_traffic_state", { segment_id: "1", status: "'free'", source_feed: "'f'", last_seen_at: T(10) }],
      ["public.city_traffic_state", { segment_id: "2", status: "null", source_feed: "'f'", last_seen_at: T(10) }],
      ["public.city_traffic_state", { segment_id: "3", status: "'jam'", source_feed: "'f'", last_seen_at: T(0) }],
      ["public.city_traffic_pulls", { feed_key: "'f'", observed_at: T(10), measured_at: T(9) }],
      ["public.city_traffic_pulls", { feed_key: "'g'", observed_at: T(0), measured_at: T(-1) }],
    ],
    query: "select segment_id::int, status, to_char(measured_at at time zone 'UTC', 'HH24:MI') as measured from public.city_traffic_now_live order by 1, 3",
    expect: [{ segment_id: 1, status: "free", measured: "12:09" }],
    mutants: [
      ["a segment with no status", "WHERE (t.status IS NOT NULL)", "WHERE true"],
      ["another feed's pull", "(p.feed_key = t.source_feed) AND", "true AND"],
      ["any pull of the feed", "(t.last_seen_at = p.observed_at)", "true"],
    ],
  },
  {
    view: "public.fuel_feed_health",
    seed: [
      ["public.ingest_runs", { provider: "'tankerkoenig'", started_at: AGO(180), finished_at: AGO(179), status: "'error'" }],
      ["public.ingest_runs", { provider: "'tankerkoenig'", started_at: AGO(30), finished_at: AGO(29), status: "'ok'" }],
      ["public.ingest_runs", { provider: "'tankerkoenig'", started_at: AGO(20), finished_at: AGO(19), status: "'degraded'" }],
      ["public.ingest_runs", { provider: "'tankerkoenig'", started_at: AGO(10), finished_at: AGO(9), status: "'error'" }],
      ["public.ingest_runs", { provider: "'tankerkoenig'", started_at: AGO(1800), finished_at: AGO(1799), status: "'ok'" }],
      ["public.ingest_runs", { provider: "'other'", started_at: AGO(5), finished_at: AGO(4), status: "'error'" }],
      ["public.fuel_station_watch", { station_id: "'s1'", active: "true", last_polled_at: AGO(10) }],
      ["public.fuel_station_watch", { station_id: "'s2'", active: "true", last_polled_at: AGO(5), last_error: "'e'" }],
      ["public.fuel_station_watch", { station_id: "'s3'", active: "true", last_polled_at: AGO(120) }],
      ["public.fuel_station_watch", { station_id: "'s4'", active: "false", last_polled_at: AGO(1) }],
      ["public.fuel_price_latest", { station_id: "'s1'", product: "'e5'", price: "1.8", observed_at: AGO(15) }],
      ["public.fuel_price_latest", { station_id: "'s4'", product: "'e5'", price: "1.8", observed_at: AGO(1) }],
      ["public.fuel_price_latest", { station_id: "'s2'", product: "'e5'", price: "1.8", observed_at: AGO(2), deleted_at: "now()" }],
    ],
    query: `select round(extract(epoch from now() - newest_observation_at) / 60)::int as newest, round(extract(epoch from now() - last_ok_run_at) / 60)::int as ok,
                   round(extract(epoch from now() - last_run_at) / 60)::int as last, runs_24h, degraded_24h, error_24h, longest_gap_s_24h, error_runs_1h,
                   active_stations, covered_last_hour, station_errors_1h from public.fuel_feed_health`,
    expect: [{ newest: 15, ok: 29, last: 10, runs_24h: 4, degraded_24h: 1, error_24h: 2, longest_gap_s_24h: 9000, error_runs_1h: 1, active_stations: 3, covered_last_hour: 1, station_errors_1h: 1 }],
    mutants: [
      ["another provider's runs", "WHERE ((ingest_runs.provider = 'tankerkoenig'::text) AND (ingest_runs.started_at >= (now() - '24:00:00'::interval)))", "WHERE (true AND (ingest_runs.started_at >= (now() - '24:00:00'::interval)))"],
      ["the runs before the day", "AND (ingest_runs.started_at >= (now() - '24:00:00'::interval)))", "AND true)"],
      ["an inactive station's price", "ON (((w.station_id = l.station_id) AND w.active)))) AS newest_observation_at", "ON ((w.station_id = l.station_id)))) AS newest_observation_at"],
      ["the newest run of any status as the last ok", "(ingest_runs.status = 'ok'::text))) AS last_ok_run_at", "true)) AS last_ok_run_at"],
      ["the errors before the hour", "(ingest_runs.status = 'error'::text) AND (ingest_runs.started_at >= (now() - '01:00:00'::interval)))))::integer AS error_runs_1h", "(ingest_runs.status = 'error'::text) AND true)))::integer AS error_runs_1h"],
      ["every station as active", "count(*) FILTER (WHERE fuel_station_watch.active) AS active_stations", "count(*) AS active_stations"],
      ["a station with an error as covered", "(fuel_station_watch.last_error IS NULL) AND", "true AND"],
      ["a station polled before the hour as covered", "AND (fuel_station_watch.last_polled_at >= (now() - '01:00:00'::interval)))) AS covered_last_hour", "AND true)) AS covered_last_hour"],
    ],
  },
  {
    view: "public.fuel_station_board_live",
    seed: [
      ["public.fuel_stations", { id: "'A'", name: "'A'" }],
      ["public.fuel_stations", { id: "'B'", name: "'B'", deleted_at: "now()" }],
      ["public.fuel_stations", { id: "'C'", name: "'C'" }],
      ["public.fuel_price_latest", { station_id: "'A'", product: "'e5'", price: "1.8", is_open: "true", observed_at: T(1) }],
      ["public.fuel_price_latest", { station_id: "'A'", product: "'e10'", price: "1.7", is_open: "null", observed_at: T(2) }],
      ["public.fuel_price_latest", { station_id: "'A'", product: "'diesel'", price: "0", observed_at: T(3) }],
      ["public.fuel_price_latest", { station_id: "'B'", product: "'e5'", price: "1.9", observed_at: T(1) }],
      ["public.fuel_price_latest", { station_id: "'C'", product: "'e5'", price: "null", observed_at: T(1) }],
      ["public.fuel_price_latest", { station_id: "'C'", product: "'diesel'", price: "1.6", is_open: "false", observed_at: T(1) }],
    ],
    query: "select name, e5::text, e10::text, diesel::text, to_char(observed_at at time zone 'UTC', 'HH24:MI') as at from public.fuel_station_board_live order by name",
    expect: [{ name: "A", e5: "1.800", e10: "1.700", diesel: null, at: "12:02" }],
    mutants: [
      ["a price of zero", "(f.price > (0)::numeric)", "true"],
      ["a closed station's price", "(f.is_open IS NOT FALSE)", "true"],
      ["e5 as e10", "(f.product = 'e10'::text)) AS e10", "(f.product = 'e5'::text)) AS e10"],
      ["a deleted station", "JOIN public.fuel_stations_live s ON", "JOIN public.fuel_stations s ON"],
    ],
  },
  {
    view: "public.fuel_station_watch_due",
    seed: [
      ["public.fuel_station_watch", { station_id: "'a'", active: "true", priority: "5", refresh_interval_s: "600", last_polled_at: "null" }],
      ["public.fuel_station_watch", { station_id: "'b'", active: "false", priority: "5", refresh_interval_s: "600", last_polled_at: "null" }],
      ["public.fuel_station_watch", { station_id: "'c'", active: "true", priority: "1", refresh_interval_s: "600", last_polled_at: "now() - interval '700 seconds'" }],
      ["public.fuel_station_watch", { station_id: "'d'", active: "true", priority: "5", refresh_interval_s: "600", last_polled_at: "now() - interval '500 seconds'" }],
      ["public.fuel_station_watch", { station_id: "'e'", active: "true", priority: "5", refresh_interval_s: "600", consecutive_errors: "3", last_polled_at: "now() - interval '1000 seconds'" }],
      ["public.fuel_station_watch", { station_id: "'f'", active: "true", priority: "5", refresh_interval_s: "600", consecutive_errors: "3", last_polled_at: "now() - interval '1300 seconds'" }],
      ["public.fuel_station_watch", { station_id: "'g'", active: "true", priority: "5", refresh_interval_s: "600", consecutive_errors: "10", last_polled_at: "now() - interval '3000 seconds'" }],
      ["public.fuel_station_watch", { station_id: "'h'", active: "true", priority: "5", refresh_interval_s: "600", consecutive_errors: "10", last_polled_at: "now() - interval '3700 seconds'" }],
    ],
    query: "select string_agg(station_id, ' ') as due from (select station_id from public.fuel_station_watch_due) x",
    expect: [{ due: "c a h f" }],
    mutants: [
      ["an inactive station", "WHERE (active AND", "WHERE (true AND"],
      ["a station never polled", "(last_polled_at IS NULL) OR", "false OR"],
      ["the backoff from the third error", "((consecutive_errors - 3) + 1)", "(consecutive_errors - 3)"],
      ["a backoff capped at ten hours", "GREATEST((3600)::double precision,", "GREATEST((36000)::double precision,"],
      ["the order without the priority", "ORDER BY priority, last_polled_at NULLS FIRST", "ORDER BY last_polled_at NULLS FIRST"],
      ["the never-polled last", "ORDER BY priority, last_polled_at NULLS FIRST", "ORDER BY priority, last_polled_at NULLS LAST"],
    ],
  },
  {
    view: "public.gtfs_route_kreise",
    seed: [
      ["public.trips", { gtfs_feed_key: "1", id: "'t1'", route_id: "'r1'" }],
      ["public.trips", { gtfs_feed_key: "1", id: "'t2'", route_id: "'r1'" }],
      ["public.trips", { gtfs_feed_key: "1", id: "'t3'", route_id: "'r2'", deleted_at: "now()" }],
      ["public.trips", { gtfs_feed_key: "1", id: "'t4'", route_id: "'r3'" }],
      ["public.stop_times", { gtfs_feed_key: "1", trip_id: "'t1'", stop_sequence: "1", stop_id: "'de:05315:1'" }],
      ["public.stop_times", { gtfs_feed_key: "1", trip_id: "'t1'", stop_sequence: "2", stop_id: "'de:05315:2'" }],
      ["public.stop_times", { gtfs_feed_key: "1", trip_id: "'t1'", stop_sequence: "3", stop_id: "'de:11000:9'" }],
      ["public.stop_times", { gtfs_feed_key: "1", trip_id: "'t2'", stop_sequence: "1", stop_id: "'de:09162:1'" }],
      ["public.stop_times", { gtfs_feed_key: "1", trip_id: "'t2'", stop_sequence: "2", stop_id: "'de:01001:1'", deleted_at: "now()" }],
      ["public.stop_times", { gtfs_feed_key: "1", trip_id: "'t3'", stop_sequence: "1", stop_id: "'de:02000:1'" }],
      ["public.stop_times", { gtfs_feed_key: "1", trip_id: "'t4'", stop_sequence: "1", stop_id: "'de:0531x:1'" }],
      ["public.stop_times", { gtfs_feed_key: "1", trip_id: "'t4'", stop_sequence: "2", stop_id: "'at:12345:1'" }],
    ],
    refresh: ["public.gtfs_route_kreise"],
    query: "select gtfs_feed_key::int, route_id, kreise from public.gtfs_route_kreise order by route_id",
    expect: [{ gtfs_feed_key: 1, route_id: "r1", kreise: ["05315", "09162", "11000"] }],
    mutants: [
      ["a deleted stop time", "WHERE ((st.deleted_at IS NULL) AND", "WHERE (true AND"],
      ["a stop that is not German", "(st.stop_id ~~ 'de:_____:%'::text)", "true"],
      ["a deleted trip", "WHERE ((t.deleted_at IS NULL) AND", "WHERE (true AND"],
      ["a Kreis that is not five digits", "(k.kreis ~ '^\\d{5}$'::text)", "true"],
      ["the Kreis one character on", "SUBSTRING(st.stop_id FROM 4 FOR 5) AS kreis", "SUBSTRING(st.stop_id FROM 5 FOR 5) AS kreis"],
    ],
  },
  {
    view: "public.gtfs_untimed_trips",
    seed: [
      ...untimed("u1"),
      ["public.stop_times", { gtfs_feed_key: "1", trip_id: "'u2'", stop_sequence: "1", stop_id: "'a'", departure: "'10:00'" }],
      ["public.stop_times", { gtfs_feed_key: "1", trip_id: "'u3'", stop_sequence: "1", stop_id: "'a'", departure: "'10:00'" }],
      ["public.stop_times", { gtfs_feed_key: "1", trip_id: "'u3'", stop_sequence: "2", stop_id: "'b'", arrival: "'10:05'" }],
      ...untimed("u4"),
      ["public.stop_times", { gtfs_feed_key: "1", trip_id: "'u4'", stop_sequence: "3", stop_id: "'c'", departure: "'10:30'", deleted_at: "now()" }],
      ["public.stop_times", { gtfs_feed_key: "1", trip_id: "'u5'", stop_sequence: "1", stop_id: "'a'", arrival: "'10:00'" }],
      ["public.stop_times", { gtfs_feed_key: "1", trip_id: "'u5'", stop_sequence: "2", stop_id: "'b'", departure: "'10:00'" }],
    ],
    refresh: ["public.gtfs_untimed_trips"],
    query: "select string_agg(trip_id, ' ' order by trip_id) as trips from public.gtfs_untimed_trips",
    expect: [{ trips: "u1 u4 u5" }],
    mutants: [
      ["a deleted stop time", "  WHERE (deleted_at IS NULL)\n", "  WHERE true\n"],
      ["a trip of one stop", "HAVING ((count(*) > 1) AND", "HAVING (true AND"],
      ["a trip whose times move", "= max(COALESCE(arrival, departure))", "<= max(COALESCE(arrival, departure))"],
    ],
  },
  {
    view: "public.lorry_reads_live",
    seed: [
      ["public.feed_runs", { feed_key: "'lorry_bast_langlkw'", status: "'ok'", finished_at: T(1) }],
      ["public.feed_runs", { feed_key: "'lorry_bast_langlkw'", status: "'error'", finished_at: T(2) }],
      ["public.feed_runs", { feed_key: "'lorry_hh_langlkw'", status: "'degraded'", items_changed: "3", finished_at: T(3) }],
      ["public.feed_runs", { feed_key: "'lorry_hh_langlkw'", status: "'degraded'", items_changed: "null", finished_at: T(4) }],
      ["public.feed_runs", { feed_key: "'lorry_sevas_nrw'", status: "'unchanged'", finished_at: "null" }],
      ["public.feed_runs", { feed_key: "'other_feed'", status: "'ok'", finished_at: T(5) }],
    ],
    query: "select source_feed, to_char(read_at at time zone 'UTC', 'HH24:MI') as read_at from public.lorry_reads_live order by 1",
    expect: [
      { source_feed: "lorry_bast_langlkw", read_at: "12:01" },
      { source_feed: "lorry_hh_langlkw", read_at: "12:03" },
    ],
    mutants: [
      ["a feed that is not a lorry feed", "WHERE ((feed_key = ANY (ARRAY[", "WHERE ((true OR feed_key = ANY (ARRAY["],
      ["a failed run", "((status = ANY (ARRAY['ok'::text, 'unchanged'::text])) OR", "((status <> 'held'::text) OR"],
      ["a degraded run with no count", "(items_changed IS NOT NULL)", "true"],
      ["an unfinished run", "AND (finished_at IS NOT NULL))", "AND true)"],
    ],
  },
  {
    view: "public.los_lane_now_live",
    seed: [
      ...losSites("c"),
      ...(
        [
          ["L1", "c1", {}],
          ["L2", "c1", { closed_at: "now()" }],
          ["L3", "c1", { confidentiality: "'restrictedToAuthorities'" }],
          ["L4", "c2", {}],
          ["L5", "c3", {}],
          ["L6", "c4", {}],
          ["L7", "c5", {}],
          ["L8", "c6", {}],
          ["L9", "c1", {}],
        ] as const
      ).flatMap(([lane, site, s]): Seed[] => [
        ["public.los_lane_sites", { lane_id: q(lane), site_id: q(site), ...s }],
        ["public.los_lane_state", { lane_id: q(lane), site_id: q(site), status: "'free'", ...(lane === "L9" ? { confidentiality: "'restrictedToAuthorities'" } : {}) }],
      ]),
    ],
    query: "select lane_id, road, status from public.los_lane_now_live order by 1",
    expect: [{ lane_id: "L1", road: "A1", status: "free" }],
    mutants: [
      ["a closed lane", "WHERE ((s.closed_at IS NULL) AND", "WHERE (true AND"],
      ["a closed site", "(c.closed_at IS NULL) AND", "true AND"],
      ["a site off the main carriageway", "(c.carriageway = 'hfb'::text) AND", "true AND"],
      ["a site with no road", "(c.road IS NOT NULL) AND", "true AND"],
      ["a site with no place", "(c.geom IS NOT NULL) AND", "true AND"],
      ["a restricted lane", "(COALESCE(s.confidentiality, 'noRestriction'::text) = 'noRestriction'::text) AND", "true AND"],
      ["a restricted lane state", "(COALESCE(t.confidentiality, 'noRestriction'::text) = 'noRestriction'::text) AND", "true AND"],
      ["a restricted site", "(COALESCE(c.confidentiality, 'noRestriction'::text) = 'noRestriction'::text))", "true)"],
    ],
  },
  {
    view: "public.los_now_live",
    seed: [
      ...losSites("S"),
      losSite("S7"),
      ...["S1", "S2", "S3", "S4", "S5", "S6", "S7"].map((s): Seed => ["public.los_state", { site_id: q(s), status: "'jam'", ...(s === "S7" ? { confidentiality: "'restrictedToAuthorities'" } : {}) }]),
    ],
    query: "select site_id, road, status from public.los_now_live order by 1",
    expect: [{ site_id: "S1", road: "A1", status: "jam" }],
    mutants: [
      ["a closed site", "WHERE ((s.closed_at IS NULL) AND", "WHERE (true AND"],
      ["a site off the main carriageway", "(s.carriageway = 'hfb'::text) AND", "true AND"],
      ["a site with no road", "(s.road IS NOT NULL) AND", "true AND"],
      ["a site with no place", "(s.geom IS NOT NULL) AND", "true AND"],
      ["a restricted site", "(COALESCE(s.confidentiality, 'noRestriction'::text) = 'noRestriction'::text) AND", "true AND"],
      ["a restricted state", "(COALESCE(t.confidentiality, 'noRestriction'::text) = 'noRestriction'::text))", "true)"],
    ],
  },
  {
    view: "public.motorway_register_live",
    seed: [
      ...(
        [
          ["A1", 58, 1],
          ["A7", 57, 1],
          ["A8", 58, 2],
          ["B27", 58, 1],
          ["A07", 58, 1],
          ["A1000", 58, 1],
        ] as const
      ).map(([road, cid, tabcd], i): Seed => ["public.tmc_locations", { road_number: q(road), cid: String(cid), tabcd: String(tabcd), lcd: String(100 + i) }]),
      ...["A1", "A99", "A 5", "A0"].map((road): Seed => ["public.autobahn_roads", { road: q(road) }]),
    ],
    query: "select string_agg(road, ' ' order by road) as roads, count(*)::int as n from public.motorway_register_live",
    expect: [{ roads: "A1 A99", n: 2 }],
    mutants: [
      ["another country's table", "WHERE ((t.cid = 58) AND", "WHERE (true AND"],
      ["another location table", "(t.tabcd = 1) AND", "true AND"],
      ["a TMC road that is no motorway", "(t.road_number ~ '^A[1-9][0-9]{0,2}$'::text))", "true)"],
      ["an Autobahn API road that is no motorway", "WHERE (r.road ~ '^A[1-9][0-9]{0,2}$'::text)) u", "WHERE true) u"],
      ["a road twice", "        UNION\n", "        UNION ALL\n"],
    ],
  },
  {
    view: "public.osm_street_tiles",
    seed: [
      ["public.osm_streets", { osm_id: "1", cls: "2", geom: LINE(500000, 5500000) }],
      ["public.osm_streets", { osm_id: "2", cls: "2", geom: LINE(500200, 5500100) }],
      ["public.osm_streets", { osm_id: "3", cls: "2", geom: LINE(501500, 5500100) }],
      ["public.osm_streets", { osm_id: "4", cls: "1", geom: LINE(500000, 5500000) }],
      ["public.osm_streets", { osm_id: "5", cls: "3", geom: LINE(500000, 5500000), closed_at: "now()" }],
      ["public.osm_streets", { osm_id: "6", cls: "3", geom: LINE(500000, 5500000) }],
    ],
    refresh: ["public.osm_street_tiles"],
    query: "select cls::int, tx, ty, ways, st_numgeometries(geom) as parts from public.osm_street_tiles order by 1, 2, 3",
    expect: [
      { cls: 2, tx: 500, ty: 5500, ways: 2, parts: 2 },
      { cls: 2, tx: 501, ty: 5500, ways: 1, parts: 1 },
      { cls: 3, tx: 500, ty: 5500, ways: 1, parts: 1 },
    ],
    mutants: [
      ["a closed street", "WHERE ((closed_at IS NULL) AND", "WHERE (true AND"],
      ["the smallest class", "AND (cls >= 2))", "AND true)"],
      ["tiles of ten kilometres", "/ (2000)::double precision)))::integer AS tx", "/ (20000)::double precision)))::integer AS tx"],
    ],
  },
  {
    view: "public.osm_street_tiles_lo",
    seed: [
      ["public.osm_streets", { osm_id: "1", cls: "2", geom: LINE(500000, 5500000), geom_lo: LINE(500000, 5500000) }],
      ["public.osm_streets", { osm_id: "2", cls: "4", geom: LINE(500000, 5500000), geom_lo: LINE(500000, 5500000) }],
      ["public.osm_streets", { osm_id: "3", cls: "5", geom: LINE(500000, 5500000), geom_lo: LINE(500000, 5500000) }],
      ["public.osm_streets", { osm_id: "4", cls: "1", geom: LINE(500000, 5500000), geom_lo: LINE(500000, 5500000) }],
      ["public.osm_streets", { osm_id: "5", cls: "3", geom: LINE(500000, 5500000), geom_lo: "null" }],
      ["public.osm_streets", { osm_id: "6", cls: "3", geom: LINE(500000, 5500000), geom_lo: LINE(500000, 5500000), closed_at: "now()" }],
    ],
    refresh: ["public.osm_street_tiles_lo"],
    query: "select cls::int, tx, ty, ways from public.osm_street_tiles_lo order by 1, 3, 2",
    expect: [
      { cls: 2, tx: 50, ty: 550, ways: 1 },
      { cls: 4, tx: 50, ty: 550, ways: 1 },
    ],
    mutants: [
      ["a closed street", "WHERE ((closed_at IS NULL) AND", "WHERE (true AND"],
      ["the smallest class", "((cls >= 2) AND", "(true AND"],
      ["the minor classes", "(cls <= 4))", "true)"],
      ["a street with no simplified line", "AND (geom_lo IS NOT NULL))", "AND true)"],
      ["tiles of one kilometre", "/ (20000)::double precision)))::integer AS tx", "/ (2000)::double precision)))::integer AS tx"],
    ],
  },
  {
    view: "public.service_alert_lands_live",
    seed: [
      ["public.delfi_service_alerts", { alert_id: "'a1'", lands: "'{05,09}'", placed_by: "'stop'", last_seen_at: T(1) }],
      ["public.delfi_service_alerts", { alert_id: "'a2'", lands: "'{05}'", placed_by: "'route'", last_seen_at: T(2) }],
      ["public.delfi_service_alerts", { alert_id: "'a3'", lands: "'{11}'", placed_by: "'agency'", last_seen_at: T(3) }],
      ["public.delfi_service_alerts", { alert_id: "'a4'", lands: "'{14}'", placed_by: "'stop'", confidentiality: "'restrictedToAuthorities'", last_seen_at: T(3) }],
      ["public.delfi_service_alerts", { alert_id: "'a5'", lands: "'{05}'", placed_by: "'stop'", confidentiality: "'noRestriction'", last_seen_at: T(0) }],
    ],
    query: "select land, to_char(last_seen_at at time zone 'UTC', 'HH24:MI') as seen, alerts from public.service_alert_lands_live order by 1",
    expect: [
      { land: "05", seen: "12:02", alerts: 3 },
      { land: "09", seen: "12:01", alerts: 1 },
    ],
    mutants: [
      ["an alert placed by agency", "(a.placed_by = ANY (ARRAY['stop'::text, 'route'::text])) AND", "true AND"],
      ["a restricted alert", "(COALESCE(a.confidentiality, 'noRestriction'::text) = 'noRestriction'::text))", "true)"],
      ["the oldest sighting", "max(a.last_seen_at) AS last_seen_at", "min(a.last_seen_at) AS last_seen_at"],
    ],
  },
  {
    view: "public.station_index_live",
    seed: [
      ["public.db_stations", { station_no: "'1'", name: "'One'" }],
      ["public.db_stations", { station_no: "'2'", name: "'Two'", closed_at: "now()" }],
      ["public.db_stations", { station_no: "'3'", name: "'Three'" }],
      ["public.station_slugs", { slug: "'b'", station_no: "'1'", name: "'One'", assigned_at: T(1) }],
      ["public.station_slugs", { slug: "'a'", station_no: "'1'", name: "'One'", assigned_at: T(1) }],
      ["public.station_slugs", { slug: "'old'", station_no: "'1'", name: "'One'", assigned_at: T(0) }],
      ["public.station_slugs", { slug: "'x'", station_no: "'2'", name: "'Two'", assigned_at: T(0) }],
    ],
    query: "select station_no, slug, name from public.station_index_live order by 1",
    expect: [{ station_no: "1", slug: "a", name: "One" }],
    mutants: [
      ["a closed station", "  WHERE (s.closed_at IS NULL);", "  WHERE true;"],
      ["the first slug", "ORDER BY g.assigned_at DESC, g.slug", "ORDER BY g.assigned_at, g.slug"],
      ["the last of two slugs of one instant", "ORDER BY g.assigned_at DESC, g.slug\n", "ORDER BY g.assigned_at DESC, g.slug DESC\n"],
      ["another station's slug", "WHERE (g.station_no = s.station_no)", "WHERE true"],
    ],
  },
  {
    view: "public.traffic_count_now_live",
    seed: [
      ["public.traffic_count_sites", { id: "1" }],
      ["public.traffic_count_sites", { id: "2" }],
      ["public.traffic_count_sites", { id: "3", closed_at: "now()" }],
      ["public.traffic_count_sites", { id: "4" }],
      ["public.traffic_count_latest", { site_id: "1", measure: "'vehicles'", vehicles: "10" }],
      ["public.traffic_count_latest", { site_id: "1", measure: "'heavy'", vehicles: "2" }],
      ["public.traffic_count_latest", { site_id: "2", measure: "'vehicles'", vehicles: "5" }],
      ["public.traffic_count_latest", { site_id: "3", measure: "'vehicles'", vehicles: "7" }],
    ],
    query: "select site_id::int, vehicles, heavy from public.traffic_count_now_live order by 1",
    expect: [
      { site_id: 1, vehicles: 10, heavy: 2 },
      { site_id: 2, vehicles: 5, heavy: null },
      { site_id: 4, vehicles: null, heavy: null },
    ],
    mutants: [
      ["a closed site", "  WHERE (s.closed_at IS NULL);", "  WHERE true;"],
      ["the heavy count as the vehicles", "(v.measure = 'vehicles'::text)", "(v.measure = 'heavy'::text)"],
      ["the vehicles as the heavy count", "(h.measure = 'heavy'::text)", "(h.measure = 'vehicles'::text)"],
      ["a site with no count", "LEFT JOIN public.traffic_count_latest v ON", "JOIN public.traffic_count_latest v ON"],
    ],
  },
  {
    view: "public.traffic_count_profiles_live",
    seed: [
      ["public.traffic_count_sites", { id: "1", source_feed: "'f'" }],
      ["public.traffic_count_sites", { id: "2", source_feed: "'f'", closed_at: "now()" }],
      ["public.traffic_count_sites", { id: "3", source_feed: "'g'" }],
      ...(
        [
          [1, "f", "2026-09-01"],
          [1, "f", "2026-10-01"],
          [1, "f", "2026-08-01"],
          [2, "f", "2026-10-01"],
          [3, "g", "2026-08-01"],
        ] as const
      ).map(([site, feed, month]): Seed => ["public.traffic_count_profiles", { site_id: String(site), source_feed: q(feed), month: `date '${month}'`, day_kind: "'weekday'", hour: "8" }]),
    ],
    query: "select site_id::int, to_char(month, 'YYYY-MM') as month from public.traffic_count_profiles_live order by 1, 2",
    expect: [
      { site_id: 1, month: "2026-10" },
      { site_id: 3, month: "2026-08" },
    ],
    mutants: [
      ["an older month", "(n.month = p.month)", "true"],
      ["another feed's newest month", "ON (((n.source_feed = p.source_feed) AND", "ON ((true AND"],
      ["the oldest month", "max(traffic_count_profiles.month) AS month", "min(traffic_count_profiles.month) AS month"],
      ["a closed site", "AND (s.closed_at IS NULL))));", "AND true)));"],
    ],
  },
  {
    view: "public.transit_departures_odbl_live",
    seed: [
      ["domains.transit_agencies_odbl", odbl({ external_id: "'AG'", agency_name: "'Agency'", agency_timezone: "'Europe/Berlin'" })],
      ["domains.transit_routes_odbl", odbl({ external_id: "'R1'", agency_id: "'AG'", route_short_name: "'S1'", route_type: "109" })],
      ["domains.transit_trips_odbl", odbl({ external_id: "'T1'", route_id: "'R1'", service_id: "'S1'", trip_headsign: "'H'" })],
      ["domains.transit_trips_odbl", odbl({ external_id: "'T2'", route_id: "'R1'", service_id: "'S1'", closed_at: "now()" })],
      ["domains.transit_trips_odbl", odbl({ external_id: "'T3'", route_id: "'R1'", service_id: "'S2'" })],
      ["domains.transit_service_dates_odbl", odbl({ external_id: "'d1'", service_id: "'S1'", service_date: TODAY })],
      ["domains.transit_service_dates_odbl", odbl({ external_id: "'d2'", service_id: "'S2'", service_date: `${TODAY} + 5` })],
      ...(
        [
          ["T1", 1, "A", "3600", {}],
          ["T1", 2, "B", "null", {}],
          ["T1", 3, "C", "5400", { pickup_type: "1" }],
          ["T1", 4, "D", "7200", { stop_headsign: "'HD'" }],
          ["T1", 5, "E", "9000", {}],
          ["T1", 6, "F", "9900", { closed_at: "now()" }],
          ["T2", 1, "A", "3600", {}],
          ["T2", 2, "B", "4000", {}],
          ["T3", 1, "A", "3600", {}],
          ["T3", 2, "B", "4000", {}],
        ] as const
      ).map(([trip, seq, stop, dep, s]): Seed => ["domains.transit_stop_times_odbl", odbl({ external_id: q(`${trip}-${String(seq)}`), trip_id: q(trip), stop_sequence: String(seq), stop_id: q(stop), departure_s: dep, ...s })]),
      ["domains.transit_trip_updates_odbl", { source_id: "'s'", external_id: "'u1'", entity_id: "'u1'", trip_id: "'T1'", start_date: TODAY, stop_id: "'D'", stop_sequence: "4", departure_delay_s: "60" }],
      ["domains.transit_trip_updates_odbl", { source_id: "'s'", external_id: "'u2'", entity_id: "'u2'", trip_id: "'T1'", start_date: `${TODAY} - 1`, stop_id: "'A'", stop_sequence: "1", departure_delay_s: "30" }],
    ],
    query: `select stop_id, departure_s, headsign, route_short_name, agency_name, rt_at_stop, rt_delay_s, rt_trip_cancelled,
                   departs_at = transit_odbl_departs_at(${TODAY}, 'Europe/Berlin', departure_s) as at_ok
              from public.transit_departures_odbl_live order by trip_id, stop_sequence`,
    expect: [
      { stop_id: "A", departure_s: 3600, headsign: "H", route_short_name: "S1", agency_name: "Agency", rt_at_stop: null, rt_delay_s: null, rt_trip_cancelled: false, at_ok: true },
      { stop_id: "D", departure_s: 7200, headsign: "HD", route_short_name: "S1", agency_name: "Agency", rt_at_stop: true, rt_delay_s: 60, rt_trip_cancelled: false, at_ok: true },
    ],
    mutants: [
      ["a stop time with no departure", "(st.departure_s IS NOT NULL) AND", "true AND"],
      ["a stop with no boarding", "(COALESCE(st.pickup_type, 0) <> 1) AND", "true AND"],
      ["the last stop", "(n.stop_sequence > st.stop_sequence) AND", "true AND"],
      ["the last open stop when a later one is closed", "AND (n.closed_at IS NULL)))));", "AND true))));"],
      ["a closed trip", "(t.feed_version = st.feed_version) AND (t.closed_at IS NULL))))", "(t.feed_version = st.feed_version) AND true)))"],
      ["a service day past the window", "(d.service_date <= (((now() AT TIME ZONE 'UTC'::text))::date + 2))", "true"],
      ["another day's trip update", "(x.start_date = d.service_date) AND", "true AND"],
    ],
  },
  {
    view: "public.transit_odbl_service_days_live",
    seed: [
      ["domains.transit_agencies_odbl", odbl({ external_id: "'a1'", agency_name: "'Lis'", agency_timezone: "'Europe/Lisbon'" })],
      ["domains.transit_agencies_odbl", odbl({ external_id: "'a2'", agency_name: "'NY'", agency_timezone: "'America/New_York'", closed_at: "now()" })],
      ["domains.transit_agencies_odbl", odbl({ external_id: "'a3'", agency_name: "'Ber'", agency_timezone: "'Europe/Berlin'" })],
    ],
    query: `select string_agg((service_date - ${TODAY})::text || ' ' || tz, ', ' order by tz, service_date) as days,
                   bool_and(day_starts_at = transit_odbl_departs_at(service_date, tz, 0)) as starts_ok from public.transit_odbl_service_days_live`,
    expect: [{ days: "-1 Europe/Berlin, 0 Europe/Berlin, 1 Europe/Berlin, 2 Europe/Berlin, -1 Europe/Lisbon, 0 Europe/Lisbon, 1 Europe/Lisbon, 2 Europe/Lisbon", starts_ok: true }],
    mutants: [
      ["no yesterday", "generate_series('-1'::integer, 2)", "generate_series(0, 2)"],
      ["a closed agency's zone", "WHERE ((ag.closed_at IS NULL) AND", "WHERE (true AND"],
      ["Berlin twice", "        UNION\n", "        UNION ALL\n"],
    ],
  },
  {
    view: "public.transit_punctuality_area_live",
    before: [TD_PART],
    seed: [
      delay("a", "de:05315:1", 5, "400"),
      delay("a", "de:05315:2", 5, "100"),
      delay("a", "de:09162:2", 5, "10"),
      delay("b", "de:05315:1", 5, "60"),
      delay("c", "de:05158:7", 5, "null", { schedule_relationship: "'SKIPPED'" }),
      delay("d", "de:05158:8", 5, "30"),
      delay("e", "de:05315:3", 40, "900"),
      delay("f", "de:05315:4", 5, "900", { source: "'other'" }),
      delay("h", "de:09162:1", 5, "500"),
      ...untimed("d"),
      ["public.gazetteer_places", { source_id: "'bkg_gvisys'", kind: "'city'", admin_code: "'05315000'", name: "'Köln'" }],
      ["public.gazetteer_places", { source_id: "'bkg_gvisys'", kind: "'district'", admin_code: "'05315'", name: "'Köln (Kreis)'" }],
      ["public.gazetteer_places", { source_id: "'bkg_gvisys'", kind: "'district'", admin_code: "'05158'", name: "'Kreis Mettmann'" }],
      ["public.gazetteer_places", { source_id: "'bkg_gvisys'", kind: "'city'", admin_code: "'05158001'", name: "'A town'" }],
      ["public.gazetteer_places", { source_id: "'bkg_gvisys'", kind: "'city'", admin_code: "'09162000'", name: "'München'", closed_at: "now()" }],
    ],
    refresh: ["public.gtfs_untimed_trips"],
    query: `select level, area, name, trips_observed as obs, trips_late as late, trips_skipped_stop as skipped, trips_untimed as untimed, median_worst_delay_s as median, stops_seen as stops
              from public.transit_punctuality_area_live where newest is not null order by level, area`,
    expect: [
      { level: "all", area: "de", name: null, obs: 3, late: 2, skipped: 1, untimed: 1, median: 400, stops: 6 },
      { level: "city", area: "05315", name: "Köln", obs: 2, late: 1, skipped: 0, untimed: 0, median: 230, stops: 2 },
      { level: "kreis", area: "05158", name: "Kreis Mettmann", obs: 0, late: 0, skipped: 1, untimed: 1, median: null, stops: 2 },
      { level: "land", area: "05", name: null, obs: 2, late: 1, skipped: 1, untimed: 1, median: 230, stops: 4 },
      { level: "land", area: "09", name: null, obs: 2, late: 1, skipped: 0, untimed: 0, median: 255, stops: 2 },
    ],
    mutants: [
      ["a delay older than half an hour", "(d0.observed_at >= (now() - '00:30:00'::interval)) AND", "true AND"],
      ["another source's delay", "(d0.source = 'delfi_rt_tu'::text) AND", "true AND"],
      ["no skipped stop", "((d0.delay_s IS NOT NULL) OR (d0.schedule_relationship = 'SKIPPED'::text))", "(d0.delay_s IS NOT NULL)"],
      ["late from half a minute", "bool_or((w.delay_s > 300)) AS late", "bool_or((w.delay_s > 30)) AS late"],
      ["an untimed trip observed in its Land", "(count(*) FILTER (WHERE (t.timed AND (NOT t.untimed))))::integer AS trips_observed", "(count(*) FILTER (WHERE t.timed))::integer AS trips_observed"],
      ["a trip once per Land in the nation", "WHERE (p.level = 'trip'::text)\n          GROUP BY p.trip_id", "WHERE (p.level = 'trip'::text)\n          GROUP BY p.trip_id, p.area"],
      ["a closed city", "(g.kind = 'city'::text) AND (g.closed_at IS NULL)", "(g.kind = 'city'::text) AND true"],
      ["a town as its Kreis's city", "(g.admin_code ~ '^[0-9]{5}000$'::text)", "true"],
      ["a Kreis that is a city as well", "  WHERE (NOT (EXISTS ( SELECT 1\n           FROM cities c", "  WHERE (true OR (EXISTS ( SELECT 1\n           FROM cities c"],
      ["the nation's ninetieth percentile", "(percentile_cont((0.5)::double precision) WITHIN GROUP (ORDER BY ((n.worst)::double precision))", "(percentile_cont((0.9)::double precision) WITHIN GROUP (ORDER BY ((n.worst)::double precision))"],
    ],
  },
  {
    view: "public.transit_punctuality_live",
    before: [TD_PART],
    seed: [
      delay("a", "de:05315:1", 5, "400"),
      delay("b", "de:05315:1", 5, "60"),
      delay("c", "de:05315:1", 5, "null", { schedule_relationship: "'SKIPPED'" }),
      delay("e", "de:05315:1", 40, "900"),
      delay("f", "de:05315:1", 5, "900", { source: "'other'" }),
      delay("h", "de:09162:1", 5, "10"),
      delay("i", "de:1234:1", 5, "10"),
      delay("j", "de:09162:1", -5, "10"),
    ],
    query: "select land, trips_observed as obs, trips_late as late from public.transit_punctuality_live order by 1",
    expect: [
      { land: "05", obs: 2, late: 1 },
      { land: "09", obs: 1, late: 0 },
    ],
    mutants: [
      ["a delay older than half an hour", "(d0.observed_at >= (now() - '00:30:00'::interval)) AND", "true AND"],
      ["a delay from the future", "(d0.observed_at <= now()) AND", "true AND"],
      ["another source's delay", "(d0.source = 'delfi_rt_tu'::text) AND", "true AND"],
      ["a row with no delay", "AND (d0.delay_s IS NOT NULL))", "AND true)"],
      ["a four-digit area code", "= ANY (ARRAY[2, 3, 5, 8]))", "= ANY (ARRAY[2, 3, 4, 5, 8]))"],
      ["late from a minute", "bool_or((d.delay_s > 300)) AS late", "bool_or((d.delay_s > 59)) AS late"],
      ["a Land with no trip", "  WHERE (t.trips_observed > 0);", "  WHERE true;"],
    ],
  },
  {
    view: "public.transit_station_live",
    before: [TD_PART],
    seed: [
      ...["de:11000:900003201", "de:11000:900003201:1:2", "de:11000:900003201_x", "de:11000:9000032010", "de:11000:900003202"].map((id): Seed => ["public.stops", { gtfs_feed_key: "1", id: q(id) }]),
      ["public.stops", { gtfs_feed_key: "1", id: "'de:11000:900003201:9'", deleted_at: "now()" }],
      ["public.stops", { gtfs_feed_key: "2", id: "'de:11000:900003201:7'" }],
      delay("a", "de:11000:900003201:1:2", 5, "400"),
      delay("b", "de:11000:900003201", 5, "0"),
      delay("c", "de:11000:9000032010", 5, "900"),
      delay("d", "de:11000:900003201_x", 5, "null", { schedule_relationship: "'SKIPPED'" }),
      delay("e", "de:11000:900003201", 40, "900"),
      delay("u", "de:11000:900003201", 5, "0"),
      ...untimed("u"),
    ],
    refresh: ["public.gtfs_untimed_trips"],
    query: `select ord, stops_known as stops, trips_observed as obs, trips_late as late, trips_skipped_stop as skipped, trips_untimed as untimed, median_worst_delay_s as median
              from public.transit_station_live order by ord`,
    expect: [
      { ord: 1, stops: 3, obs: 2, late: 1, skipped: 1, untimed: 1, median: 200 },
      ...[2, 3, 4, 5, 6, 7, 8].map((ord) => ({ ord, stops: 0, obs: 0, late: 0, skipped: 0, untimed: 0, median: null })),
    ],
    mutants: [
      ["another feed's stop", "JOIN public.stops st ON (((st.gtfs_feed_key = 1) AND", "JOIN public.stops st ON ((true AND"],
      ["a deleted stop", "(st.deleted_at IS NULL) AND ((st.id = h.dhid)", "true AND ((st.id = h.dhid)"],
      ["a stop past the platform range", "(st.id ~<~ (h.dhid || ';'::text))", "true"],
      ["a delay older than half an hour", "(d.observed_at >= (now() - '00:30:00'::interval)) AND", "true AND"],
      ["no skipped stop", "((d.delay_s IS NOT NULL) OR (d.schedule_relationship = 'SKIPPED'::text))", "(d.delay_s IS NOT NULL)"],
      ["late on time", "bool_or((w.delay_s > 300)) AS late", "bool_or((w.delay_s >= 0)) AS late"],
      ["an untimed trip in the median", "FILTER (WHERE (t.timed AND (NOT t.untimed))))::integer AS median_worst_delay_s", "FILTER (WHERE t.timed))::integer AS median_worst_delay_s"],
    ],
  },
  {
    view: "public.transit_stop_modes",
    seed: [
      ["public.stops", { gtfs_feed_key: "1", id: "'P'", name: "'Hbf'" }],
      ["public.stops", { gtfs_feed_key: "1", id: "'C1'", name: "'C1 name'", parent_id: "'P'" }],
      ["public.stops", { gtfs_feed_key: "1", id: "'C2'", name: "'C2 name'", parent_id: "'P'" }],
      ["public.stops", { gtfs_feed_key: "1", id: "'S'", name: "'Solo'" }],
      ["public.stops", { gtfs_feed_key: "1", id: "'Q'", name: "'Q'" }],
      ...(
        [
          ["R1", 109, "' S1 '", {}],
          ["R2", 3, "''", {}],
          ["R3", 715, "'X'", {}],
          ["R4", 1700, "'O'", {}],
          ["R5", 0, "'T'", { deleted_at: "now()" }],
          ["R6", 2, "'RE1'", {}],
        ] as const
      ).map(([id, type, short, s]): Seed => ["public.routes", { gtfs_feed_key: "1", id: q(id), route_type: String(type), short_name: short, ...s }]),
      ...(
        [
          ["T1", "R1", "C1", {}],
          ["T2", "R2", "C2", {}],
          ["T3", "R4", "S", {}],
          ["T4", "R5", "S", {}],
          ["T5", "R3", "S", { deleted_at: "now()" }],
          ["T6", "R6", "Q", {}],
        ] as const
      ).flatMap(([trip, route, stop, s]): Seed[] => [
        ["public.trips", { gtfs_feed_key: "1", id: q(trip), route_id: q(route), ...s }],
        ["public.stop_times", { gtfs_feed_key: "1", trip_id: q(trip), stop_sequence: "1", stop_id: q(stop) }],
      ]),
    ],
    refresh: ["public.transit_stop_modes"],
    query: "select root_id, name, modes, lines, stop_ids from public.transit_stop_modes order by root_id",
    expect: [
      { root_id: "P", name: "Hbf", modes: ["bus", "sbahn"], lines: ["S1"], stop_ids: ["C1", "C2"] },
      { root_id: "Q", name: "Q", modes: ["rail"], lines: ["RE1"], stop_ids: ["Q"] },
    ],
    mutants: [
      ["the S-Bahn as rail", "WHEN (r.route_type = 109) THEN 'sbahn'::text", "WHEN (r.route_type = 108) THEN 'sbahn'::text"],
      ["the other mode", "FILTER (WHERE (typed.mode <> 'other'::text)) AS modes", "AS modes"],
      ["a stop with no mode", "  WHERE (f.modes IS NOT NULL)\n", "  WHERE true\n"],
      ["a deleted route", "(r.id = (v.route_id COLLATE \"C\")) AND (r.deleted_at IS NULL))))", "(r.id = (v.route_id COLLATE \"C\")) AND true)))"],
      ["a deleted trip", "(t.id = (st.trip_id COLLATE \"C\")) AND (t.deleted_at IS NULL))))", "(t.id = (st.trip_id COLLATE \"C\")) AND true)))"],
      ["an empty line name", "NULLIF(btrim(r.short_name), ''::text) AS line", "btrim(r.short_name) AS line"],
      ["the child's name over the parent's", "COALESCE(p.name, f.child_name) AS name", "f.child_name AS name"],
    ],
  },
  {
    view: "public.weather_warnings_area_live",
    seed: [
      ["public.weather_warnings", { identifier: "'w1'", warncell_id: "'105315000'", headline: "'DE'", published_at: T(0), valid_from: T(0), valid_to: T(60), raw: `'{"properties":{"EC_II":"31"}}'` }],
      ["public.weather_warnings", { identifier: "'w2'", warncell_id: "'105315000'", headline: "'DE2'", published_at: T(0), valid_from: T(0), valid_to: T(60), raw: `'{"properties":{"EC_II":"40"}}'` }],
      ["public.weather_warnings", { identifier: "'w3'", warncell_id: "'105315000'", headline: "'DE3'", published_at: T(0), valid_from: T(0), valid_to: T(60), raw: "'{}'", deleted_at: "now()" }],
      ["public.weather_warnings_en", { identifier: "'e1'", base_identifier: "'w1'", language: "'en'", headline: "'EN'", sent_at: T(0), valid_from: T(0), valid_to: T(60), warncell_ids: "'{105315000}'", raw: `'{"eventCodes":{"II":"31"}}'` }],
    ],
    query: "select identifier, headline, en_headline from public.weather_warnings_area_live order by 1",
    expect: [
      { identifier: "w1", headline: "DE", en_headline: "EN" },
      { identifier: "w2", headline: "DE2", en_headline: null },
    ],
    mutants: [
      ["a warning with no English", "LEFT JOIN LATERAL public.weather_warning_english(w.id)", "JOIN LATERAL public.weather_warning_english(w.id)"],
      ["a deleted warning", "FROM (public.weather_warnings_live w", "FROM (public.weather_warnings w"],
      ["the German headline as the English", "    en.en_headline,\n", "    w.headline AS en_headline,\n"],
    ],
  },
];
