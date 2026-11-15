/**
 * The filter views (#32): each view here is one base table read through a
 * predicate (or a plain projection). The cases are the data both
 * test/views-filter.db.test.ts and scripts/mutants-schema-behaviour.ts read:
 * the test seeds `base` once as a row the view must return and once per `out`
 * entry as a row it must not; the mutants negate the view's WHERE and drop
 * each `drops` snippet of it, so every condition is shown to be the one that
 * keeps its row out.
 *
 * Values are SQL expressions. Columns not named are filled by type.
 */
export type ViewCase = {
  readonly view: string;
  readonly table: string;
  /** The column that tells the seeded rows apart; by default the first primary-key column the view shows, else its first text or integer column. */
  readonly tag?: string;
  readonly base?: Readonly<Record<string, string>>;
  readonly out: readonly Readonly<Record<string, string>>[];
  /** Snippets of the view's WHERE in the baseline; a mutant replaces each by `true`. */
  readonly drops?: readonly string[];
  /** SQL run first, as the owner, in the same transaction. */
  readonly setup?: string;
};

const GBFS_SYSTEMS = `insert into gbfs_systems (system_id, name, publisher, admitted, licence_read_at, first_seen_at, last_seen_at, source_feed, source_publisher, license_id, licence_basis, refused_reason)
            values ('sys', 'System', 'gbfs_nextbike', true, now(), now(), now(), 'gbfs_nextbike', 'p', 'CC0-1.0', 'stated', null),
                   ('sys_no', 'Not admitted', 'gbfs_nextbike', false, now(), now(), now(), 'gbfs_nextbike', 'p', null, null, 'no licence')`;

const closed = (view: string, table: string, col = "closed_at"): ViewCase => ({ view, table, out: [{ [col]: "now()" }] });

export const VIEW_CASES: readonly ViewCase[] = [
  closed("public.bfrk_stops_live", "public.bfrk_stops"),
  closed("public.bw_detours_live", "public.bw_detours"),
  closed("public.charging_points_live", "public.charging_points", "deleted_at"),
  closed("public.fuel_price_latest_live", "public.fuel_price_latest", "deleted_at"),
  closed("public.fuel_stations_live", "public.fuel_stations", "deleted_at"),
  closed("public.hh_cameras_live", "public.hh_cameras"),
  closed("public.hydrogen_stations_live", "public.hydrogen_stations"),
  closed("public.lez_zones_live", "public.lez_zones"),
  closed("public.lorry_city_live", "public.lorry_city"),
  closed("public.lorry_hb_live", "public.lorry_hb"),
  closed("public.lorry_ivm_live", "public.lorry_ivm"),
  closed("public.lorry_long_network_live", "public.lorry_long_network"),
  closed("public.lorry_sevas_live", "public.lorry_sevas"),
  closed("public.mvv_bus_load_live", "public.mvv_bus_load"),
  closed("public.osm_addresses_live", "public.osm_addresses"),
  closed("public.osm_pois_live", "public.osm_pois"),
  closed("public.osm_speed_cameras_live", "public.osm_speed_cameras"),
  closed("public.parking_facilities_bysa_live", "public.parking_facilities_bysa"),
  closed("public.parking_facilities_live", "public.parking_facilities", "deleted_at"),
  closed("public.parking_facilities_odbl_live", "public.parking_facilities_odbl"),
  closed("public.parking_forecast_profiles_live", "public.parking_forecast_profiles", "deleted_at"),
  closed("public.parking_sites_live", "public.parking_sites", "deleted_at"),
  closed("public.road_events_live", "public.road_events", "deleted_at"),
  closed("public.routes_live", "public.routes", "deleted_at"),
  closed("public.speed_enforcement_live", "public.speed_enforcement"),
  closed("public.station_accessibility_live", "public.station_accessibility"),
  closed("public.station_equipment_live", "public.station_equipment"),
  closed("public.stop_times_live", "public.stop_times", "deleted_at"),
  closed("public.stops_live", "public.stops", "deleted_at"),
  closed("public.trips_live", "public.trips", "deleted_at"),
  closed("public.weather_warnings_en_live", "public.weather_warnings_en"),
  closed("public.weather_warnings_live", "public.weather_warnings", "deleted_at"),
  {
    view: "public.road_weather_stations_live",
    table: "public.road_weather_stations",
    base: { inactive: "false" },
    out: [{ closed_at: "now()" }, { inactive: "true" }],
    drops: ["(closed_at IS NULL)", "(NOT inactive)"],
  },
  {
    view: "public.road_context_live",
    table: "public.road_context_features",
    base: { answerable: "true" },
    out: [{ closed_at: "now()" }, { answerable: "false" }],
    drops: ["(closed_at IS NULL)", "answerable)"],
  },
  {
    view: "public.hh_roadworks_live",
    table: "public.hh_roadworks",
    base: { released: "true" },
    out: [{ closed_at: "now()" }, { released: "false" }],
    drops: ["(closed_at IS NULL)", "released)"],
  },
  {
    view: "public.charging_sites_live",
    table: "public.charging_sites",
    // access_private is generated from the name
    base: { name: "'Rathausplatz'" },
    out: [{ deleted_at: "now()" }, { name: "'Privatparkplatz Müller'" }],
    drops: ["(deleted_at IS NULL)", "(NOT access_private)"],
  },
  {
    view: "public.transit_stops_odbl_live",
    table: "domains.transit_stops_odbl",
    base: { geom: "ST_SetSRID(ST_MakePoint(7, 50), 4326)" },
    out: [{ closed_at: "now()" }, { geom: "null" }],
    drops: ["(closed_at IS NULL)", "(geom IS NOT NULL)"],
  },
  {
    view: "public.station_metro_osm_decided",
    table: "public.station_metro_osm",
    base: { decisive: "true" },
    out: [{ decisive: "false" }],
  },
  {
    view: "public.motorway_points_live",
    table: "public.tmc_locations",
    base: { cid: "58", tabcd: "1", road_number: "'A7'" },
    out: [{ cid: "57" }, { tabcd: "2" }, { road_number: "'B27'" }, { road_number: "'A0'" }, { road_number: "'A1000'" }],
    drops: ["(cid = 58)", "(tabcd = 1)", "(road_number ~ '^A[1-9][0-9]{0,2}$'::text)"],
  },
  {
    view: "public.vbb_transit_delays_live",
    table: "public.vbb_transit_delays",
    base: { observed_at: "now() - interval '2 hours 59 minutes'" },
    out: [{ observed_at: "now() - interval '3 hours 1 minute'" }],
  },
  {
    view: "public.vbn_transit_delays_live",
    // through the vbn_transit_delays view of the SIRI calls
    table: "public.vbn_siri_et_calls",
    base: { observed_at: "now() - interval '2 hours 59 minutes'" },
    out: [{ observed_at: "now() - interval '3 hours 1 minute'" }],
  },
  {
    view: "public.vrn_transit_delays_live",
    table: "public.vrn_transit_delays",
    base: { observed_at: "now() - interval '2 hours 59 minutes'" },
    out: [{ observed_at: "now() - interval '3 hours 1 minute'" }],
  },
  {
    view: "public.delfi_siri_et_calls_live",
    table: "public.delfi_siri_et_calls",
    base: { observed_at: "now() - interval '7 hours 59 minutes'" },
    out: [{ observed_at: "now() - interval '8 hours 1 minute'" }, { observed_at: "now() + interval '1 minute'" }],
    drops: ["(observed_at > (now() - '08:00:00'::interval))", "(observed_at <= now())"],
  },
  {
    view: "public.gbfs_station_status_live",
    table: "public.gbfs_station_status",
    base: { observed_at: "now() - interval '24 hours 59 minutes'" },
    out: [{ observed_at: "now() - interval '25 hours 1 minute'" }],
  },
  {
    view: "public.los_sites_live",
    table: "public.los_sites",
    base: { confidentiality: "null" },
    out: [{ closed_at: "now()" }, { confidentiality: "'restrictedToAuthorities'" }],
    drops: ["(closed_at IS NULL)", "(COALESCE(confidentiality, 'noRestriction'::text) = 'noRestriction'::text)"],
  },
  {
    view: "public.delfi_service_alerts_live",
    table: "public.delfi_service_alerts",
    base: { confidentiality: "'noRestriction'" },
    out: [{ closed_at: "now()" }, { confidentiality: "'restrictedToAuthorities'" }],
    drops: ["(closed_at IS NULL)", "(COALESCE(confidentiality, 'noRestriction'::text) = 'noRestriction'::text)"],
  },
  {
    view: "public.opendata_roadworks_live",
    table: "public.opendata_roadworks",
    base: { answerable: "true", affects_traffic: "true" },
    out: [{ closed_at: "now()" }, { answerable: "false" }, { affects_traffic: "false" }],
    drops: ["(closed_at IS NULL)", "answerable AND", "affects_traffic)"],
  },
  closed("public.street_bays_live", "public.street_bays"),
  {
    view: "public.gbfs_vehicles_live",
    table: "public.gbfs_vehicles",
    setup: GBFS_SYSTEMS,
    base: { system_id: "'sys'" },
    out: [{ system_id: "'sys_no'" }],
  },
  {
    view: "public.transit_delays_live",
    table: "public.transit_delays",
    tag: "trip_id",
    base: { observed_at: "now() - interval '5 hours 59 minutes'", source: "'delfi_rt_tu'" },
    out: [{ observed_at: "now() - interval '6 hours 1 minute'" }, { observed_at: "now() + interval '1 minute'" }, { source: "'vbb'" }],
    drops: ["(observed_at > (now() - '06:00:00'::interval))", "(observed_at <= now())", "(source = 'delfi_rt_tu'::text)"],
  },
  {
    view: "public.connect_transit_delays_live",
    table: "public.connect_transit_delays",
    tag: "trip_id",
    base: { observed_at: "now() - interval '5 hours 59 minutes'" },
    out: [{ observed_at: "now() - interval '6 hours 1 minute'" }, { observed_at: "now() + interval '1 minute'" }],
    drops: ["(observed_at > (now() - '06:00:00'::interval))", "(observed_at <= now())"],
  },
  { view: "public.vbn_transit_delays", table: "public.vbn_siri_et_calls", out: [] },
  // plain projections: the view shows every row of its table
  { view: "public.city_traffic_segments_live", table: "public.city_traffic_segments", out: [] },
  { view: "public.city_traffic_pulls_live", table: "public.city_traffic_pulls", tag: "feed_key", out: [] },
  { view: "public.road_weather_forecast_live", table: "public.road_weather_forecast", tag: "station_id", out: [] },
  { view: "public.charging_feed_runs_live", table: "public.feed_runs", out: [] },
  { view: "public.db_facilities_live", table: "public.db_facilities", out: [] },
  { view: "public.parking_occupancy_live", table: "public.parking_occupancy", tag: "facility_id", out: [] },
  { view: "public.parking_occupancy_sid_live", table: "public.parking_occupancy_sid", tag: "facility_id", out: [] },
  { view: "public.parking_occupancy_odbl_live", table: "public.parking_occupancy_odbl", tag: "facility_id", out: [] },
  { view: "public.charging_point_status_live", table: "public.charging_point_status", tag: "evse_id", out: [] },
  { view: "public.motorway_summary_live", table: "public.motorway_summary", out: [] },
  { view: "public.parking_facilities_sid_live", table: "public.parking_facilities_sid", out: [] },
  {
    view: "public.gbfs_stations_live",
    table: "public.gbfs_stations",
    tag: "station_id",
    setup: GBFS_SYSTEMS,
    base: { system_id: "'sys'" },
    out: [{ closed_at: "now()" }, { system_id: "'sys_no'" }],
    drops: ["(st.closed_at IS NULL)", "sy.admitted)"],
  },
];
