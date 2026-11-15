-- no-transaction: builds one partial GiST index on the populated
-- weather_warnings with create index concurrently, which PostgreSQL refuses
-- inside a transaction block. Idempotent: an INVALID index a failed build left
-- is dropped first, and the build is if not exists.
--
-- A GiST over the PLANAR area of the open warnings, so a read that tests
-- st_intersects(w.area::geometry, <points>) along a road probes the index once
-- per point instead of testing every warning in force. The existing
-- weather_warnings_area_gist is over the geography and over every historical
-- row, so it cannot serve a planar test.
--
-- The expression is (area::geometry) exactly, the text such a read writes, so
-- PostGIS's support function turns the st_intersects into an index condition.
-- Partial on closed_at is null and deleted_at is null: every reader reaches
-- the rows through weather_warnings_live (deleted_at is null) and the in-force
-- predicate (closed_at is null), the predicate of weather_warnings_live_cell
-- and weather_warnings_live_key.
--
-- A concurrent build holds SHARE UPDATE EXCLUSIVE, which blocks no insert or
-- update of the warnings' writer.
--
-- rollback:
--   drop index concurrently if exists weather_warnings_live_area_geom;
--   delete from schema_migrations where version = 294;

set max_parallel_maintenance_workers = 0;
set maintenance_work_mem = '64MB';

select format('drop index concurrently if exists public.%I', i.relname)
  from pg_class i
  join pg_index x on x.indexrelid = i.oid
 where i.relname = 'weather_warnings_live_area_geom'
   and i.relnamespace = 'public'::regnamespace
   and not x.indisvalid
\gexec

create index concurrently if not exists weather_warnings_live_area_geom
  on public.weather_warnings using gist ((area::geometry))
  where closed_at is null and deleted_at is null;
