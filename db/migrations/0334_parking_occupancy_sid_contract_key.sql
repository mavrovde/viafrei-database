-- no-transaction: builds each day partition's index with create index concurrently,
-- which PostgreSQL refuses inside a transaction block. On an empty database it
-- builds the whole index: the parent's, one per existing day partition, each
-- attached; a day partition made later (partitions ensure) gets its own from the
-- parent. On a database that holds it in part or in full it adopts what is there
-- (0319's rule):
--   a partition whose index is attached           is skipped;
--   a VALID matching index, not attached          is attached, never built twice;
--   an INVALID matching index (a failed build)    is dropped and built again;
--   no matching index                             is built and attached.
--
-- viafrei-database#57: contract.occupancy_observation names a SID truck park
-- 'sid:' || parking_occupancy_sid.facility_id, and every reader asks for one
-- facility by that name (the API's ParkingNear: o.facility_id = f.facility_id,
-- the newest report at or before now, and the earliest after it). No index held
-- the name, so for EVERY facility near the point — a 'p:' or 'odbl:' one too,
-- which the SID branch can never match — the plan read each day partition of
-- parking_occupancy_sid whole (a lossy bitmap, about 1 M heap blocks a
-- partition). Production 2026-11-23, read only: the API's read at München,
-- 3 km, was cancelled at 30 s. This index is on exactly the view's expression,
-- so the equality and the order by observed_at are one index probe per day
-- partition; the rows are the view's own, unchanged (no view is rewritten).
--
-- A concurrent build holds SHARE UPDATE EXCLUSIVE, which blocks no writer; the
-- parent's ON ONLY index and the attaches take a short lock under lock_timeout.
--
-- rollback:
--   drop index if exists public.parking_occupancy_sid_contract_key;
--   delete from schema_migrations where version = 334;

set max_parallel_maintenance_workers = 0;
set maintenance_work_mem = '64MB';

-- An INVALID matching partition index (a failed concurrent build; an INVALID index cannot be attached).
select format('drop index concurrently if exists %I.%I', n.nspname, i.relname)
  from pg_inherits h
  join pg_index x on x.indrelid = h.inhrelid
  join pg_class i on i.oid = x.indexrelid
  join pg_namespace n on n.oid = i.relnamespace
 where h.inhparent = 'public.parking_occupancy_sid'::regclass
   and not x.indisvalid
   and not x.indisunique and x.indpred is null
   and split_part(pg_get_indexdef(x.indexrelid), ' USING ', 2) = $k$btree ((('sid:'::text || facility_id)), observed_at)$k$
\gexec

-- 1. The parent's index, catalogue only.
begin;
set local lock_timeout = '5s';
create index if not exists parking_occupancy_sid_contract_key on only public.parking_occupancy_sid (('sid:' || facility_id), observed_at);
commit;

-- 2. Each partition with no index attached to the parent's and no VALID matching index to adopt: built concurrently.
select format('create index concurrently if not exists %I on %I.%I (($k$sid:$k$ || facility_id), observed_at)', p.relname || '_contract_key', n.nspname, p.relname)
  from pg_inherits h
  join pg_class p on p.oid = h.inhrelid
  join pg_namespace n on n.oid = p.relnamespace
 where h.inhparent = 'public.parking_occupancy_sid'::regclass
   and not exists (
         select 1 from pg_index x
          where x.indrelid = p.oid and x.indisvalid
            and not x.indisunique and x.indpred is null
            and split_part(pg_get_indexdef(x.indexrelid), ' USING ', 2) = $k$btree ((('sid:'::text || facility_id)), observed_at)$k$)
 order by p.relname
\gexec

-- 3. Each partition with no index attached: its VALID matching index attached (the one named <partition>_geom_idx
--    first), one statement (and one short lock) per partition; the parent's index turns VALID with the last.
set lock_timeout = '5s';
select format('alter index public.parking_occupancy_sid_contract_key attach partition %I.%I', n.nspname, m.relname)
  from pg_inherits h
  join pg_class p on p.oid = h.inhrelid
  join pg_namespace n on n.oid = p.relnamespace
  cross join lateral (
         select i.relname from pg_index x join pg_class i on i.oid = x.indexrelid
          where x.indrelid = p.oid and x.indisvalid
            and not x.indisunique and x.indpred is null
            and split_part(pg_get_indexdef(x.indexrelid), ' USING ', 2) = $k$btree ((('sid:'::text || facility_id)), observed_at)$k$
          order by i.relname <> p.relname || '_contract_key', i.relname
          limit 1) m
 where h.inhparent = 'public.parking_occupancy_sid'::regclass
   and not exists (
         select 1 from pg_index x join pg_inherits a on a.inhrelid = x.indexrelid
          where x.indrelid = p.oid and a.inhparent = 'public.parking_occupancy_sid_contract_key'::regclass)
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
   where c.oid = 'public.parking_occupancy_sid_contract_key'::regclass
     and not x.indisvalid;
  if bad is not null then
    raise exception 'parking_occupancy_sid contract key: % still INVALID — a partition index is missing or not attached', bad;
  end if;
end
$$;
