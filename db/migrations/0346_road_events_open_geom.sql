-- no-transaction: builds road_events_open_geom with create index concurrently,
-- which PostgreSQL refuses inside a transaction block. Idempotent: the build is
-- if not exists, and an INVALID index of the name (a concurrent build that
-- failed) is dropped first and built again. A database that already holds the
-- index keeps it as it is.
--
-- road_events_open_geom: a GiST index on road_events.geom over the open rows
-- only (closed_at is null and deleted_at is null). The place round's road read
-- (every place page and every motorway exit page, one round a page) and the
-- other readers of the open events in a box find them by
--   geom && st_makeenvelope(...) and deleted_at is null and closed_at is null
-- Their only spatial index was road_events_geom_gist, over every row with a
-- geom, closed ones included. Production, read only, 2026-11-25: 69 686 rows,
-- 16 071 of them open; at the A1 exit 84 (Dortmund/Unna) the read's box holds
-- 1 521 rows, 109 of them open, so the index scan visited 1 521 heap rows and
-- the filter threw away 1 480 (3.5 ms of the node, 1 694 buffers). Over the open
-- rows alone the scan visits the 109. The rows the readers return are the same:
-- the index's predicate is a conjunct of each reader's WHERE.
--
-- road_events_geom_gist stays (20.7 million scans on production): a reader whose
-- WHERE does not carry both conditions cannot use the partial index.
--
-- rollback:
--   drop index concurrently if exists public.road_events_open_geom;
--   delete from schema_migrations where version = 346;

set max_parallel_maintenance_workers = 0;
set maintenance_work_mem = '64MB';

set lock_timeout = '5s';
select 'drop index concurrently ' || x.indexrelid::regclass::text
  from pg_index x
 where x.indexrelid = to_regclass('public.road_events_open_geom') and not x.indisvalid
\gexec
create index concurrently if not exists road_events_open_geom on public.road_events using gist (geom)
  where closed_at is null and deleted_at is null;
reset lock_timeout;

do $$
begin
  if not exists (select from pg_index x where x.indexrelid = to_regclass('public.road_events_open_geom') and x.indisvalid) then
    raise exception 'public.road_events_open_geom missing or INVALID after its build';
  end if;
end
$$;
