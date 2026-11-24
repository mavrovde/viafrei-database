-- api_reader reads what the MCP server reads for answers it lacks.
--
-- viafrei-api reproduces today's MCP answers on the platform's own tables
-- (0336). Eight objects behind those answers are read by viafrei_mcp but were
-- not granted to api_reader: the road weather stations and forecast, the live
-- English DWD warnings, the VBB, VRN and VBN delay ticks, the untimed GTFS
-- trips, and the English twin of a German warning. This release grants each
-- by name, SELECT on the relations and EXECUTE on the function, never "all
-- tables in schema". Table-level grants only, as 0336.
--
-- Every object is the public one viafrei_mcp is granted: public.road_weather_*
-- are not the domains.* tables of the same name (0300), which stay ungranted.
-- vbb_ and vrn_transit_delays are day-partitioned: the grant on the parent
-- covers a read through it, the partitions stay unreadable directly, as for
-- transit_delays. vbn_transit_delays and weather_warnings_en_live are
-- owner-rights views: the tables under them (vbn_siri_et_calls,
-- weather_warnings_en) stay unreadable to api_reader, as viafrei_mcp holds
-- neither. gtfs_untimed_trips is a materialized view under
-- transit_punctuality_area_live, which 0336 left unreadable on purpose; it is
-- granted now because today's MCP punctuality answer reads it directly (the
-- coverage and the untimed trips it reports beside
-- transit_punctuality_area_live). weather_warning_english(bigint) is SECURITY
-- DEFINER, as for viafrei_mcp and viafrei_digest: as its owner it reads only
-- the two live views weather_warnings_live (not granted to api_reader) and
-- weather_warnings_en_live, and returns the English text and hash of the one
-- warning asked.
--
-- The licence and confidentiality rules (contract_source_rules) are not
-- enforced by these grants: the API's own statements apply them, as 0336 says,
-- and every rendering of these rows owes its terms:
--   - VBB, VRN and VBN delays: CC BY 4.0, with the attribution of each source;
--   - VBN, in addition, its conditions V1-V4 and R1-R4: the register line
--     alone, no share-alike line on a VBN-only figure, and a VBN figure never
--     summed with DELFI's;
--   - DWD road weather (stations, forecast): CC BY 4.0, and the Bund/Laender
--     road-weather declaration, the binding condition note shown with it.
--
-- A GRANT takes no lock on the relation; re-applied, every statement is a
-- no-op (a privilege held is granted again without change).
--
-- rollback:
--   revoke select on public.road_weather_forecast from api_reader;
--   revoke select on public.road_weather_stations from api_reader;
--   revoke select on public.weather_warnings_en_live from api_reader;
--   revoke select on public.vbb_transit_delays from api_reader;
--   revoke select on public.vrn_transit_delays from api_reader;
--   revoke select on public.vbn_transit_delays from api_reader;
--   revoke select on public.gtfs_untimed_trips from api_reader;
--   revoke execute on function public.weather_warning_english(bigint) from api_reader;
--   delete from schema_migrations where version = 345;

set local lock_timeout = '5s';

grant select on public.road_weather_forecast to api_reader;
grant select on public.road_weather_stations to api_reader;
grant select on public.weather_warnings_en_live to api_reader;
grant select on public.vbb_transit_delays to api_reader;
grant select on public.vrn_transit_delays to api_reader;
grant select on public.vbn_transit_delays to api_reader;
grant select on public.gtfs_untimed_trips to api_reader;
grant execute on function public.weather_warning_english(bigint) to api_reader;
