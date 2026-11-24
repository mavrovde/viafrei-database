/** 0336: the platform relations api_reader reads, shared by its tests. */
/** The relations the 50 contract views read (pg_depend of their rules), granted to api_reader by 0336. */
export const API_READER_BASE: readonly string[] = [
  "control.data_status",
  "domains.train_board_departures",
  ...[
    "ags_regions", "autobahn_events", "autobahn_roads", "autobahn_sweeps", "charging_point_status", "charging_points", "charging_sites",
    "contract_source_domains", "contract_source_rules", "contract_sources", "db_facilities", "db_stations", "delfi_service_alerts",
    "delfi_siri_et_calls_latest", "delfi_siri_et_stop_pairs", "driving_rule_facts", "driving_rule_topics", "feed_checks", "feeds", "fuel_prices",
    "fuel_products", "fuel_stations", "gazetteer_places", "gbfs_station_status", "gbfs_stations", "gbfs_systems", "gbfs_vehicles",
    "gtfs_service_dates", "hh_cameras", "hydrogen_stations", "lez_feed_places", "lez_list_entries", "lez_zone_overlaps", "lez_zones_live",
    "licence_texts", "lorry_city_live", "lorry_hb_live", "lorry_ivm_live", "lorry_long_network_live", "lorry_sevas_live",
    "message_coverage_sources", "osm_addresses", "osm_pois", "osm_speed_cameras", "parking_facilities", "parking_facilities_bysa",
    "parking_facilities_odbl", "parking_facilities_sid", "parking_occupancy", "parking_occupancy_odbl", "parking_occupancy_sid",
    "road_event_ticks", "road_events", "routes", "source_register", "source_register_notes", "source_terms", "source_terms_texts",
    "speed_enforcement", "station_equipment", "station_equipment_state", "station_index_live", "stop_times", "stops", "street_bay_state",
    "street_bays", "tmc_locations", "transit_delays", "transit_delays_live", "transit_punctuality_area_live", "transit_stop_modes", "trips",
    "weather_warnings",
  ].map((t) => `public.${t}`),
].sort((a, b) => a.localeCompare(b));

/** The relations 0345 grants api_reader beside 0336's, read by viafrei_mcp for the answers viafrei-api reproduces. */
export const API_READER_0345: readonly string[] = [
  "gtfs_untimed_trips", "road_weather_forecast", "road_weather_stations", "vbb_transit_delays", "vbn_transit_delays", "vrn_transit_delays",
  "weather_warnings_en_live",
].map((t) => `public.${t}`);

/** Every relation outside contract that api_reader reads: 0336's and 0345's. */
export const API_READER_RELATIONS: readonly string[] = [...API_READER_BASE, ...API_READER_0345].sort((a, b) => a.localeCompare(b));
