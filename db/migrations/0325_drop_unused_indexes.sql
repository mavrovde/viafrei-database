-- no-transaction: drops four indexes with drop index concurrently, which
-- PostgreSQL refuses inside a transaction block. Idempotent: each drop is
-- if exists, so a database that no longer holds the index (production, where
-- they were dropped by hand on 2026-11-22) is left as it is.
--
-- Four indexes no read uses, dropped on production by hand on 2026-11-22
-- under the owner's standing database approval; this file makes the schema
-- agree. Each had 0 scans in pg_stat_user_indexes from 2026-11-20 to the drop,
-- and no query of the main application, viafrei-api or viafrei-ingestor filters
-- on the columns they lead with (searched before the drop):
--
--   road_event_locations_road (road_number, road_event_id): no read filters the
--     stretches by road; they are read by their event (the primary key).
--   charging_points_geom_gist (geom) where closed_at is null: no read finds a
--     charging point by distance; the distance reads go through charging_sites.
--   trips_service (gtfs_feed_key, service_id): the service-date joins are
--     driven from the trips (their primary key), never from a service.
--   stop_times_stop (gtfs_feed_key, stop_id, trip_id), 4.2 GB: 25 scans in two
--     days beside 118 M on stop_times_stop_tod and 47 M on
--     stop_times_stop_arr_tod, which lead with the same (gtfs_feed_key, stop_id)
--     and carry trip_id, so a read that could use it plans through those.
--
-- Kept: energy_page_keys_feed. ENERGY_PAGE_FEEDS_SQL (the charging list when a
-- feed is hidden) is planned through it; it had no scan only because no feed
-- was hidden.
--
-- A concurrent drop takes SHARE UPDATE EXCLUSIVE and waits for the
-- transactions that use the index, then ACCESS EXCLUSIVE on the index alone
-- for a moment: no writer of the tables is blocked.
--
-- rollback:
--   create index concurrently if not exists road_event_locations_road on public.road_event_locations using btree (road_number, road_event_id);
--   create index concurrently if not exists charging_points_geom_gist on public.charging_points using gist (geom) where (closed_at is null);
--   create index concurrently if not exists trips_service on public.trips using btree (gtfs_feed_key, service_id);
--   create index concurrently if not exists stop_times_stop on public.stop_times using btree (gtfs_feed_key, stop_id, trip_id);
--   delete from schema_migrations where version = 325;

-- lock_timeout bounds each drop's wait for its locks (rule 6); a drop that
-- waits longer fails with 55P03 and migrate retries the file, each drop being
-- if exists. Set for this file's session and reset at its end, as no
-- transaction holds a set local here.
set lock_timeout = '5s';
drop index concurrently if exists public.road_event_locations_road;
drop index concurrently if exists public.charging_points_geom_gist;
drop index concurrently if exists public.trips_service;
drop index concurrently if exists public.stop_times_stop;
reset lock_timeout;
