-- no-transaction: builds each day partition's index with create index concurrently,
-- which PostgreSQL refuses inside a transaction block. On an empty database it
-- builds the whole index: the parent's, one per existing day partition, each
-- attached. On a database that holds it in part or in full (production, built
-- by hand on 2026-11-19: the parent and 35 partitions, each partition's index
-- named <partition>_geom_gist) it adopts what is there and ends in the same
-- schema:
--   a partition whose index is attached           is skipped;
--   a VALID matching index, not attached          is attached, under whatever
--                                                 name it has, never built twice;
--   an INVALID matching index (a failed build)    is dropped and built again;
--   no matching index                             is built and attached.
-- "Matching" is the definition: a plain, non-unique gist on ((geom)::geometry)
-- with no predicate. Safe to run again from the top.
--
-- Names: the parent's is autobahn_events_geom_gist, production's. A partition
-- index this file builds is named <partition>_geom_idx, the name PostgreSQL
-- gives the one it clones into every day partition ensure_daily_partitions
-- makes later (test/index-names.ts), so a partition's index name does not
-- depend on whether it was built here or cloned. An adopted index keeps its
-- name: production's 35 <partition>_geom_gist leave with their partitions
-- under retention, and are not renamed here.
--
-- The place and point road reads resolve the Autobahn items inside a box with
--   ... from autobahn_events w where w.observed_at >= <30 minutes ago> and w.geom::geometry && <box>
-- No index served the box test: each call read every tick of the 30-minute
-- window (about 24 000 rows in production) and filtered them. With a GiST
-- index on (geom::geometry) the box test is an index condition. Production,
-- a Berlin place read: the Autobahn step 52 ms before, 25 to 27 ms after; the
-- rows returned identical (an md5 over three places compared).
--
-- The expression is (geom::geometry), the one the reads write: geom is a
-- geography, and && of two geometries is the operator the reads use.
--
-- A partitioned parent cannot take create index concurrently, so the index is
-- made in three steps, none of which blocks a writer for longer than a
-- catalogue update:
--   1. the parent's index ON ONLY the parent: catalogue only, INVALID until
--      every partition has its index attached;
--   2. each partition's index built concurrently (SHARE UPDATE EXCLUSIVE,
--      blocks no writer), unless a VALID matching one is there to adopt;
--   3. each attached to the parent's index; with the last, the parent's index
--      turns VALID.
-- A day partition ensure_daily_partitions makes later (create table ... like
-- excluding indexes, then attach partition) gets the index cloned from the
-- parent's at attach, under the same name, <partition>_geom_idx.
--
-- rollback:
--   drop index if exists public.autobahn_events_geom_gist;  -- drops every attached partition index with it
--   delete from schema_migrations where version = 319;

set max_parallel_maintenance_workers = 0;
set maintenance_work_mem = '64MB';

-- An INVALID matching partition index (a failed concurrent build; an INVALID index cannot be attached).
select format('drop index concurrently if exists %I.%I', n.nspname, i.relname)
  from pg_inherits h
  join pg_index x on x.indrelid = h.inhrelid
  join pg_class i on i.oid = x.indexrelid
  join pg_namespace n on n.oid = i.relnamespace
 where h.inhparent = 'public.autobahn_events'::regclass
   and not x.indisvalid
   and not x.indisunique and x.indpred is null
   and split_part(pg_get_indexdef(x.indexrelid), ' USING ', 2) = 'gist (((geom)::geometry))'
\gexec

-- 1. The parent's index, catalogue only.
begin;
set local lock_timeout = '5s';
create index if not exists autobahn_events_geom_gist on only public.autobahn_events using gist ((geom::geometry));
commit;

-- 2. Each partition with no index attached to the parent's and no VALID matching index to adopt: built concurrently.
select format('create index concurrently if not exists %I on %I.%I using gist ((geom::geometry))', p.relname || '_geom_idx', n.nspname, p.relname)
  from pg_inherits h
  join pg_class p on p.oid = h.inhrelid
  join pg_namespace n on n.oid = p.relnamespace
 where h.inhparent = 'public.autobahn_events'::regclass
   and not exists (
         select 1 from pg_index x
          where x.indrelid = p.oid and x.indisvalid
            and not x.indisunique and x.indpred is null
            and split_part(pg_get_indexdef(x.indexrelid), ' USING ', 2) = 'gist (((geom)::geometry))')
 order by p.relname
\gexec

-- 3. Each partition with no index attached: its VALID matching index attached (the one named <partition>_geom_idx
--    first), one statement (and one short lock) per partition; the parent's index turns VALID with the last.
set lock_timeout = '5s';
select format('alter index public.autobahn_events_geom_gist attach partition %I.%I', n.nspname, m.relname)
  from pg_inherits h
  join pg_class p on p.oid = h.inhrelid
  join pg_namespace n on n.oid = p.relnamespace
  cross join lateral (
         select i.relname from pg_index x join pg_class i on i.oid = x.indexrelid
          where x.indrelid = p.oid and x.indisvalid
            and not x.indisunique and x.indpred is null
            and split_part(pg_get_indexdef(x.indexrelid), ' USING ', 2) = 'gist (((geom)::geometry))'
          order by i.relname <> p.relname || '_geom_idx', i.relname
          limit 1) m
 where h.inhparent = 'public.autobahn_events'::regclass
   and not exists (
         select 1 from pg_index x join pg_inherits a on a.inhrelid = x.indexrelid
          where x.indrelid = p.oid and a.inhparent = 'public.autobahn_events_geom_gist'::regclass)
 order by p.relname
\gexec
reset lock_timeout;

-- The parent's index VALID, or the file fails and is retried from the top.
do $$
declare
  bad text;
begin
  select string_agg(c.relname, ', ') into bad
    from pg_class c join pg_index x on x.indexrelid = c.oid
   where c.oid = 'public.autobahn_events_geom_gist'::regclass
     and not x.indisvalid;
  if bad is not null then
    raise exception 'autobahn_events geom: % still INVALID — a partition index is missing or not attached', bad;
  end if;
end
$$;
