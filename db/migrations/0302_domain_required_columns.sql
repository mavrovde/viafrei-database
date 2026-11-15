-- The columns a source must fill, held by the schema: NOT NULL on the 20
-- domain columns below, and for the 17 text columns among them a check that
-- the value is not the empty string, because a writer that maps an empty field
-- to '' would otherwise pass where it should be refused. Integers and dates get
-- NOT NULL alone.
--
--   domains.road_works: title
--   domains.speed_cameras: kind
--   domains.transit_agencies_odbl: agency_name, agency_timezone, feed_version
--   domains.transit_routes_odbl: route_type, feed_version
--   domains.transit_service_dates_odbl: service_id, service_date, feed_version
--   domains.transit_stop_times_odbl: trip_id, stop_sequence, stop_id, feed_version
--   domains.transit_stops_odbl: stop_name, feed_version
--   domains.transit_trip_updates_odbl: entity_id
--   domains.transit_trips_odbl: route_id, service_id, feed_version
--
-- domains.route_recommendations has no column a source must fill beyond the
-- system columns, so nothing changes there.
--
-- The tables are locked against writes first, then every listed column is
-- counted for null and, if text, empty values. One violating row anywhere
-- refuses the whole migration with an error that names each table, column and
-- count, before any constraint is added, so the file never applies in part.
-- Clean the named rows (or let their source rewrite them) and run it again.
--
-- rollback:
--   alter table domains.road_works alter column title drop not null, drop constraint road_works_title_nonempty;
--   alter table domains.speed_cameras alter column kind drop not null, drop constraint speed_cameras_kind_nonempty;
--   alter table domains.transit_agencies_odbl alter column agency_name drop not null, alter column agency_timezone drop not null, alter column feed_version drop not null, drop constraint transit_agencies_odbl_agency_name_nonempty, drop constraint transit_agencies_odbl_agency_timezone_nonempty, drop constraint transit_agencies_odbl_feed_version_nonempty;
--   alter table domains.transit_routes_odbl alter column route_type drop not null, alter column feed_version drop not null, drop constraint transit_routes_odbl_feed_version_nonempty;
--   alter table domains.transit_service_dates_odbl alter column service_id drop not null, alter column service_date drop not null, alter column feed_version drop not null, drop constraint transit_service_dates_odbl_service_id_nonempty, drop constraint transit_service_dates_odbl_feed_version_nonempty;
--   alter table domains.transit_stop_times_odbl alter column trip_id drop not null, alter column stop_sequence drop not null, alter column stop_id drop not null, alter column feed_version drop not null, drop constraint transit_stop_times_odbl_trip_id_nonempty, drop constraint transit_stop_times_odbl_stop_id_nonempty, drop constraint transit_stop_times_odbl_feed_version_nonempty;
--   alter table domains.transit_stops_odbl alter column stop_name drop not null, alter column feed_version drop not null, drop constraint transit_stops_odbl_stop_name_nonempty, drop constraint transit_stops_odbl_feed_version_nonempty;
--   alter table domains.transit_trip_updates_odbl alter column entity_id drop not null, drop constraint transit_trip_updates_odbl_entity_id_nonempty;
--   alter table domains.transit_trips_odbl alter column route_id drop not null, alter column service_id drop not null, alter column feed_version drop not null, drop constraint transit_trips_odbl_route_id_nonempty, drop constraint transit_trips_odbl_service_id_nonempty, drop constraint transit_trips_odbl_feed_version_nonempty;
--   delete from schema_migrations where version = 302;

lock table domains.road_works, domains.speed_cameras, domains.transit_agencies_odbl, domains.transit_routes_odbl, domains.transit_service_dates_odbl, domains.transit_stop_times_odbl, domains.transit_stops_odbl, domains.transit_trip_updates_odbl, domains.transit_trips_odbl in share mode;

do $$
declare
  r record;
  n bigint;
  bad text[] := '{}';
begin
  for r in select * from (values
    ('road_works', 'title', true),
    ('speed_cameras', 'kind', true),
    ('transit_agencies_odbl', 'agency_name', true),
    ('transit_agencies_odbl', 'agency_timezone', true),
    ('transit_agencies_odbl', 'feed_version', true),
    ('transit_routes_odbl', 'route_type', false),
    ('transit_routes_odbl', 'feed_version', true),
    ('transit_service_dates_odbl', 'service_id', true),
    ('transit_service_dates_odbl', 'service_date', false),
    ('transit_service_dates_odbl', 'feed_version', true),
    ('transit_stop_times_odbl', 'trip_id', true),
    ('transit_stop_times_odbl', 'stop_sequence', false),
    ('transit_stop_times_odbl', 'stop_id', true),
    ('transit_stop_times_odbl', 'feed_version', true),
    ('transit_stops_odbl', 'stop_name', true),
    ('transit_stops_odbl', 'feed_version', true),
    ('transit_trip_updates_odbl', 'entity_id', true),
    ('transit_trips_odbl', 'route_id', true),
    ('transit_trips_odbl', 'service_id', true),
    ('transit_trips_odbl', 'feed_version', true)
  ) as v(tab, col, is_text) loop
    execute format('select count(*) from domains.%I where %I is null' || case when r.is_text then ' or %I = ''''' else '' end,
                   r.tab, r.col, r.col) into n;
    if n > 0 then
      bad := bad || format('domains.%s.%s: %s row(s) %s', r.tab, r.col, n, case when r.is_text then 'null or empty' else 'null' end);
    end if;
  end loop;
  if cardinality(bad) > 0 then
    raise exception 'required columns not filled, nothing changed: %', array_to_string(bad, '; ')
      using hint = 'fill or close the named rows, then run the migration again';
  end if;
end
$$;

alter table domains.road_works
  alter column title set not null,
  add constraint road_works_title_nonempty check (title <> '');

alter table domains.speed_cameras
  alter column kind set not null,
  add constraint speed_cameras_kind_nonempty check (kind <> '');

alter table domains.transit_agencies_odbl
  alter column agency_name set not null,
  alter column agency_timezone set not null,
  alter column feed_version set not null,
  add constraint transit_agencies_odbl_agency_name_nonempty check (agency_name <> ''),
  add constraint transit_agencies_odbl_agency_timezone_nonempty check (agency_timezone <> ''),
  add constraint transit_agencies_odbl_feed_version_nonempty check (feed_version <> '');

alter table domains.transit_routes_odbl
  alter column route_type set not null,
  alter column feed_version set not null,
  add constraint transit_routes_odbl_feed_version_nonempty check (feed_version <> '');

alter table domains.transit_service_dates_odbl
  alter column service_id set not null,
  alter column service_date set not null,
  alter column feed_version set not null,
  add constraint transit_service_dates_odbl_service_id_nonempty check (service_id <> ''),
  add constraint transit_service_dates_odbl_feed_version_nonempty check (feed_version <> '');

alter table domains.transit_stop_times_odbl
  alter column trip_id set not null,
  alter column stop_sequence set not null,
  alter column stop_id set not null,
  alter column feed_version set not null,
  add constraint transit_stop_times_odbl_trip_id_nonempty check (trip_id <> ''),
  add constraint transit_stop_times_odbl_stop_id_nonempty check (stop_id <> ''),
  add constraint transit_stop_times_odbl_feed_version_nonempty check (feed_version <> '');

alter table domains.transit_stops_odbl
  alter column stop_name set not null,
  alter column feed_version set not null,
  add constraint transit_stops_odbl_stop_name_nonempty check (stop_name <> ''),
  add constraint transit_stops_odbl_feed_version_nonempty check (feed_version <> '');

alter table domains.transit_trip_updates_odbl
  alter column entity_id set not null,
  add constraint transit_trip_updates_odbl_entity_id_nonempty check (entity_id <> '');

alter table domains.transit_trips_odbl
  alter column route_id set not null,
  alter column service_id set not null,
  alter column feed_version set not null,
  add constraint transit_trips_odbl_route_id_nonempty check (route_id <> ''),
  add constraint transit_trips_odbl_service_id_nonempty check (service_id <> ''),
  add constraint transit_trips_odbl_feed_version_nonempty check (feed_version <> '');
