-- api_reader reads the base tables behind the MCP change list's answers.
--
-- viafrei-api carries today's MCP and site statements onto the platform's own
-- tables (0336, 0345). The change list of 2026-11-25 carries more of them:
-- fuel prices with their newest tick, the DB station register and its boards,
-- the station accessibility and underground-station rows, the realtime
-- punctuality and SIRI ET ticks, the timetable's stale trips and line areas,
-- the stop access and bus-load rows of departures, the parking forecast,
-- the road works, detours, event twins and locations, jam hours and motorway
-- summaries, the traffic counts and measured levels of service, the feed run
-- log (since when a feed is read), and the charging twin and status-run rows.
-- Each was read so far by viafrei_mcp or viafrei_digest, directly or through
-- an owner-rights *_live view, and not by api_reader. This release grants
-- each by name, SELECT on the relation, never "all tables in schema", as 0336
-- and 0345.
--
-- The *_live views over these tables are not granted: the API runs the
-- statements on the base tables, and applies the filters the views apply
-- (retention windows, licence rules) in its own statements.
-- delfi_siri_et_calls and connect_transit_delays are day-partitioned: the
-- grant on the parent covers a read through it, the partitions stay
-- unreadable directly, as for transit_delays. gtfs_route_kreise is a
-- materialized view, read directly as the MCP's line statement reads it.
--
-- The licence and confidentiality rules (contract_source_rules) are not
-- enforced by these grants: the API's own statements apply them, as 0336
-- says, and every rendering of these rows owes its source's terms (the
-- ODbL rows of OpenStreetMap among them: the boundaries, the stop access).
--
-- A GRANT takes no lock on the relation; re-applied, every statement is a
-- no-op (a privilege held is granted again without change).
--
-- rollback:
--   revoke select on public.autobahn_jam_hours, public.bfrk_stops, public.bw_detours,
--     public.charging_site_twin_claims, public.charging_site_twin_pairs, public.charging_status_runs,
--     public.connect_transit_delays, public.db_station_boards, public.db_station_numbers,
--     public.delfi_siri_et_calls, public.feed_runs, public.fuel_price_latest, public.gtfs_route_kreise,
--     public.gtfs_stale_trips, public.hh_roadworks, public.los_sites, public.los_state,
--     public.motorway_summary, public.mvv_bus_load, public.opendata_roadworks, public.osm_boundary_de,
--     public.parking_forecast_profiles, public.road_event_locations, public.road_event_twins,
--     public.station_accessibility, public.station_metro_osm, public.stop_access_odbl,
--     public.traffic_count_latest, public.traffic_count_profiles, public.traffic_count_sites
--     from api_reader;
--   delete from schema_migrations where version = 347;

set local lock_timeout = '5s';

grant select on public.autobahn_jam_hours to api_reader;
grant select on public.bfrk_stops to api_reader;
grant select on public.bw_detours to api_reader;
grant select on public.charging_site_twin_claims to api_reader;
grant select on public.charging_site_twin_pairs to api_reader;
grant select on public.charging_status_runs to api_reader;
grant select on public.connect_transit_delays to api_reader;
grant select on public.db_station_boards to api_reader;
grant select on public.db_station_numbers to api_reader;
grant select on public.delfi_siri_et_calls to api_reader;
grant select on public.feed_runs to api_reader;
grant select on public.fuel_price_latest to api_reader;
grant select on public.gtfs_route_kreise to api_reader;
grant select on public.gtfs_stale_trips to api_reader;
grant select on public.hh_roadworks to api_reader;
grant select on public.los_sites to api_reader;
grant select on public.los_state to api_reader;
grant select on public.motorway_summary to api_reader;
grant select on public.mvv_bus_load to api_reader;
grant select on public.opendata_roadworks to api_reader;
grant select on public.osm_boundary_de to api_reader;
grant select on public.parking_forecast_profiles to api_reader;
grant select on public.road_event_locations to api_reader;
grant select on public.road_event_twins to api_reader;
grant select on public.station_accessibility to api_reader;
grant select on public.station_metro_osm to api_reader;
grant select on public.stop_access_odbl to api_reader;
grant select on public.traffic_count_latest to api_reader;
grant select on public.traffic_count_profiles to api_reader;
grant select on public.traffic_count_sites to api_reader;
