-- no-transaction: builds a partial GiST index with create index concurrently,
-- which PostgreSQL refuses inside a transaction block. Idempotent: an INVALID
-- index a failed build left is dropped first, and the build is if not exists,
-- so a database that already holds a valid index of the name keeps it, and the
-- check at the end stops the file unless that index is exactly this definition.
--
-- stops_geom_connect: the digest's VBN Connect read (its near step) finds, for
-- each DELFI stop of a board, the live Connect stops (gtfs_feed_key 2) within
-- 150 m: st_dwithin(cs.geom, ds.geom, 150) over stops_live with
-- cs.gtfs_feed_key = 2. The only GiST on stops.geom is stops_geom_gist over
-- every feed, so the plan read the stops of all feeds near the point and
-- filtered the other feeds away, or ANDed that bitmap with stops_id_prefix
-- over every feed-2 stop. Partial on the predicate the read states
-- (gtfs_feed_key = 2, and deleted_at is null from stops_live), the index holds
-- the Connect stops alone. Measured with EXPLAIN (ANALYZE, BUFFERS) before and
-- after, on real inputs: a large station's board about 13 times fewer buffers
-- and 4 to 8 times faster; the statement's mean shared hits a call about 15
-- times fewer.
--
-- A concurrent build holds SHARE UPDATE EXCLUSIVE, which blocks no writer.
--
-- rollback:
--   drop index concurrently if exists public.stops_geom_connect;
--   delete from schema_migrations where version = 327;

set max_parallel_maintenance_workers = 0;
set maintenance_work_mem = '64MB';

select format('drop index concurrently if exists public.%I', i.relname)
  from pg_class i
  join pg_index x on x.indexrelid = i.oid
 where i.relnamespace = 'public'::regnamespace
   and not x.indisvalid
   and i.relname in ('stops_geom_connect')
\gexec

-- The live VBN Connect stops by position: gtfs_feed_key = 2 and deleted_at is null.
create index concurrently if not exists stops_geom_connect
  on public.stops using gist (geom)
  where gtfs_feed_key = 2 and deleted_at is null;

-- if not exists keeps ANY valid index of the name: the one production was given
-- by hand is adopted only if it is exactly this definition, else the file stops
-- with an error naming both, and an operator decides (0323's rule).
do $$
declare
  expected constant text := 'CREATE INDEX stops_geom_connect ON public.stops USING gist (geom) WHERE ((gtfs_feed_key = 2) AND (deleted_at IS NULL))';
  found_def text;
begin
  select pg_get_indexdef(x.indexrelid) into found_def
    from pg_index x
    join pg_class i on i.oid = x.indexrelid
   where i.relnamespace = 'public'::regnamespace
     and i.relname = 'stops_geom_connect';
  if found_def is distinct from expected then
    raise exception 'stops_geom_connect exists with another definition: %', found_def
      using detail = 'expected: ' || expected;
  end if;
end
$$;
