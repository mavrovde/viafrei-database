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
--     open DATEX II road events and the TMC junction points;
--   * a contract id built from two columns: a charge point's site, a parking
--     facility's id (the occupancy ticks are reached through it, 0312), a
--     DATEX II situation's event id;
--   * the BKG municipality points a junction's Land is read from (0312), a
--     planar nearest-neighbour probe (a geodesic one costs ten times more per
--     junction) that must not walk the stops sharing the table.
-- All on reference or current-state tables, none on a tick table: a tick
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
                     'gazetteer_places_bkg_municipality_geom')
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
