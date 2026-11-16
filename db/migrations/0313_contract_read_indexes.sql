-- no-transaction: builds expression indexes with create index concurrently,
-- which PostgreSQL refuses inside a transaction block. Idempotent: an INVALID
-- index a failed build left is dropped first, and each build is if not exists.
--
-- The indexes the API's reads of the contract views (0312) need to stay index
-- scans (#29). Each expression is, character for character, the one a view
-- states and the API's query wraps, so the planner (and PostGIS's support
-- function for st_dwithin and <->) matches it:
--   * a position: the view's location cast to geography, which the API writes
--     as location::geography: charging sites, the four parking families, the
--     open DATEX II road events, the TMC junction points and the stops;
--   * a contract id built from two columns: a charge point's site, a parking
--     facility's id (the occupancy ticks are reached through it, 0312), a
--     DATEX II situation's event id;
--   * the BKG municipality points a junction's Land is read from (0312), a
--     planar nearest-neighbour probe (a geodesic one costs ten times more per
--     junction) that must not walk the stops sharing the table;
--   * a name's search form (contract_search_fold, 0312), trigram-indexed for
--     the API's substring search of stations and place names.
-- All on reference or current-state tables (delfi_siri_et_calls_latest holds
-- each call's newest row), none on a tick table: a tick
-- read is a probe of the tick table's own primary key.
--
-- A concurrent build holds SHARE UPDATE EXCLUSIVE, which blocks no writer.
--
-- rollback:
--   drop index concurrently if exists public.charging_sites_contract_location;
--   drop index concurrently if exists public.charging_points_contract_site;
--   drop index concurrently if exists public.parking_facilities_contract_location;
--   drop index concurrently if exists public.parking_facilities_bysa_contract_location;
--   drop index concurrently if exists public.parking_facilities_odbl_contract_location;
--   drop index concurrently if exists public.parking_facilities_sid_contract_location;
--   drop index concurrently if exists public.parking_facilities_contract_id;
--   drop index concurrently if exists public.parking_facilities_odbl_contract_id;
--   drop index concurrently if exists public.parking_facilities_sid_contract_id;
--   drop index concurrently if exists public.road_events_contract_location;
--   drop index concurrently if exists public.road_events_contract_event_id;
--   drop index concurrently if exists public.tmc_locations_contract_junction_location;
--   drop index concurrently if exists public.gazetteer_places_bkg_municipality_geom;
--   drop index concurrently if exists public.stops_contract_search_fold;
--   drop index concurrently if exists public.stops_contract_location;
--   drop index concurrently if exists public.stops_contract_stop_place;
--   drop index concurrently if exists public.stops_contract_stop_point;
--   drop index concurrently if exists public.db_stations_contract_ifopt;
--   drop index concurrently if exists public.delfi_siri_et_calls_latest_contract_ref_aimed;
--   drop index concurrently if exists public.gazetteer_places_contract_search_fold;
--   delete from schema_migrations where version = 313;

set max_parallel_maintenance_workers = 0;
set maintenance_work_mem = '64MB';

select format('drop index concurrently if exists public.%I', i.relname)
  from pg_class i
  join pg_index x on x.indexrelid = i.oid
 where i.relnamespace = 'public'::regnamespace
   and not x.indisvalid
   and i.relname in ('charging_sites_contract_location', 'charging_points_contract_site',
                     'parking_facilities_contract_location', 'parking_facilities_bysa_contract_location',
                     'parking_facilities_odbl_contract_location', 'parking_facilities_sid_contract_location',
                     'parking_facilities_contract_id', 'parking_facilities_odbl_contract_id',
                     'parking_facilities_sid_contract_id', 'road_events_contract_location',
                     'road_events_contract_event_id', 'tmc_locations_contract_junction_location',
                     'gazetteer_places_bkg_municipality_geom', 'stops_contract_search_fold', 'stops_contract_location', 'stops_contract_stop_place', 'stops_contract_stop_point',
                     'db_stations_contract_ifopt', 'delfi_siri_et_calls_latest_contract_ref_aimed',
                     'gazetteer_places_contract_search_fold')
\gexec

-- contract.charging_site: location = geom::geometry(Point, 4326); the API reads open sites.
create index concurrently if not exists charging_sites_contract_location
  on public.charging_sites using gist (((geom::geometry(Point, 4326))::geography))
  where closed_at is null;

-- contract.charge_point: site_id = source_feed || ':' || site_id.
create index concurrently if not exists charging_points_contract_site
  on public.charging_points ((source_feed || ':' || site_id))
  where deleted_at is null;

-- contract.parking_facility: location = st_pointonsurface(geom::geometry)::geometry(Point, 4326).
create index concurrently if not exists parking_facilities_contract_location
  on public.parking_facilities using gist (((st_pointonsurface(geom::geometry)::geometry(Point, 4326))::geography))
  where closed_at is null;
create index concurrently if not exists parking_facilities_bysa_contract_location
  on public.parking_facilities_bysa using gist (((st_pointonsurface(geom::geometry)::geometry(Point, 4326))::geography))
  where closed_at is null;
create index concurrently if not exists parking_facilities_odbl_contract_location
  on public.parking_facilities_odbl using gist (((st_pointonsurface(geom::geometry)::geometry(Point, 4326))::geography))
  where closed_at is null;
create index concurrently if not exists parking_facilities_sid_contract_location
  on public.parking_facilities_sid using gist (((st_pointonsurface(geom::geometry)::geometry(Point, 4326))::geography))
  where closed_at is null;

-- contract.parking_facility and occupancy_observation: facility_id = '<family>:' || id.
create index concurrently if not exists parking_facilities_contract_id
  on public.parking_facilities (('p:' || id));
create index concurrently if not exists parking_facilities_odbl_contract_id
  on public.parking_facilities_odbl (('odbl:' || id));
create index concurrently if not exists parking_facilities_sid_contract_id
  on public.parking_facilities_sid (('sid:' || id));

-- contract.traffic_event, DATEX II rows: location = st_pointonsurface(geom)::geometry(Point, 4326),
-- withdrawn_at = closed_at; event_id = 'datex:' || source_id || ':' || publication_id.
create index concurrently if not exists road_events_contract_location
  on public.road_events using gist (((st_pointonsurface(geom)::geometry(Point, 4326))::geography))
  where closed_at is null and deleted_at is null;
create index concurrently if not exists road_events_contract_event_id
  on public.road_events (('datex:' || source_id || ':' || publication_id))
  where deleted_at is null;

-- contract.junction: location = geom::geometry(Point, 4326) of the A-road junction points.
create index concurrently if not exists tmc_locations_contract_junction_location
  on public.tmc_locations using gist (((geom::geometry(Point, 4326))::geography))
  where cid = 58 and tabcd = 1 and tcd = 1 and road_number ~ '^A[1-9][0-9]{0,2}$';

-- contract.junction: state_code = the Land of the nearest BKG municipality point.
create index concurrently if not exists gazetteer_places_bkg_municipality_geom
  on public.gazetteer_places using gist ((geom::geometry))
  where source_id = 'bkg_gvisys' and kind = 'city' and geom is not null;

-- contract.stop_place and contract.place_alias: search_fold = contract_search_fold(name);
-- the API matches it with like '%' || folded text || '%'.
create index concurrently if not exists stops_contract_search_fold
  on public.stops using gin ((public.contract_search_fold(name)) gin_trgm_ops)
  where deleted_at is null;
create index concurrently if not exists gazetteer_places_contract_search_fold
  on public.gazetteer_places using gin ((public.contract_search_fold(name)) gin_trgm_ops)
  where geom is not null;

-- contract.stop_place: location = geom::geometry(Point, 4326); the API's "stations near" reads it
-- (a position-only search walked every stop without it: 1.4 s on 530 000 stops, 80 ms with it).
create index concurrently if not exists stops_contract_location
  on public.stops using gist (((geom::geometry(Point, 4326))::geography))
  where deleted_at is null;

-- contract.departure: a board is read by stop_place_id or stop_point_id, each the stop's key and id
-- (::text, so the expression is immutable); from the stop, its stop times are the stop_times_stop index.
create index concurrently if not exists stops_contract_stop_place
  on public.stops ((gtfs_feed_key::text || ':' || coalesce(parent_id, id)))
  where deleted_at is null;
create index concurrently if not exists stops_contract_stop_point
  on public.stops ((gtfs_feed_key::text || ':' || id))
  where deleted_at is null;

-- contract.stop_place and contract.departure: the DB station whose IFOPT is a stop's DHID
-- (8 761 stations, read per stop row: without it every row walked them all).
create index concurrently if not exists db_stations_contract_ifopt
  on public.db_stations (ifopt)
  where ifopt is not null;

-- contract.departure: the SIRI ET call of a stop's ref planned in a departure's minute
-- (the existing (stop_ref, expected time) index reads every call of the ref within the
-- six-hour delay bound; this one reads the minute).
create index concurrently if not exists delfi_siri_et_calls_latest_contract_ref_aimed
  on public.delfi_siri_et_calls_latest (stop_ref, aimed_dep);
