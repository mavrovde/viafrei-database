-- no-transaction: builds two partial indexes with create index concurrently,
-- which PostgreSQL refuses inside a transaction block. Idempotent: an INVALID
-- index a failed build left is dropped first, and each build is if not exists,
-- so a database that already holds a valid index of the name keeps it as it is.
--
-- Two indexes for the digest's hottest reads, each a sequential or wide bitmap
-- scan until now. Measured with EXPLAIN (ANALYZE, BUFFERS) before and after:
--
-- 1. road_events_open_feed: the road reads filter road_events_live
--    (deleted_at is null) on closed_at is null and feed_key = any(...). With
--    no index on feed_key the plan was a bitmap scan on
--    road_events_contract_location (0313) that removed every open event of
--    the other feeds by filter: 52 ms and 5,888 buffers. With it: 0.2 ms and
--    13 buffers. Partial on the live, open predicate, the one every such read
--    states.
--
-- 2. db_facilities_point_geog: the station facilities read filters
--    db_facilities_live with st_dwithin(st_point(f.lon, f.lat)::geography, ...)
--    and read the whole table per call: 38 ms and 9,968 buffers. With it: an
--    index scan of 201 buffers. The expression is, character for character,
--    the one the read writes, so PostGIS's support function for st_dwithin
--    turns the test into an index condition. Partial on a facility with a
--    position: st_point of a null is null, and no read finds one by distance.
--
-- A concurrent build holds SHARE UPDATE EXCLUSIVE, which blocks no writer.
--
-- rollback:
--   drop index concurrently if exists public.road_events_open_feed;
--   drop index concurrently if exists public.db_facilities_point_geog;
--   delete from schema_migrations where version = 317;

set max_parallel_maintenance_workers = 0;
set maintenance_work_mem = '64MB';

select format('drop index concurrently if exists public.%I', i.relname)
  from pg_class i
  join pg_index x on x.indexrelid = i.oid
 where i.relnamespace = 'public'::regnamespace
   and not x.indisvalid
   and i.relname in ('road_events_open_feed', 'db_facilities_point_geog')
\gexec

-- The open, live events of a feed: closed_at is null and deleted_at is null, by feed_key.
create index concurrently if not exists road_events_open_feed
  on public.road_events (feed_key)
  where closed_at is null and deleted_at is null;

-- A facility's position as the station facilities read writes it: st_point(lon, lat)::geography.
create index concurrently if not exists db_facilities_point_geog
  on public.db_facilities using gist ((st_point(lon, lat)::geography))
  where lon is not null and lat is not null;
