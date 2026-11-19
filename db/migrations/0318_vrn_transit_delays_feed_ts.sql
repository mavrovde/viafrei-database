-- no-transaction: builds each day partition's index with create index concurrently,
-- which PostgreSQL refuses inside a transaction block. Idempotent and safe to run
-- again from the top: an INVALID partition index a failed build left is dropped
-- first, every build is if not exists, a partition whose index is already
-- attached is skipped, and attaching an attached index is a no-op. A database
-- that already holds the index (production, built by hand with this file's
-- statements) keeps it as it is.
--
-- The digest's VRN freshness probe reads, about 180 times a minute,
--   select max(feed_ts) as newest from vrn_transit_delays_live where observed_at >= $1 and feed_ts >= $1
-- On vrn_transit_delays, day-partitioned on observed_at, no index led on
-- feed_ts: the plan was a BRIN or sequential scan of every partition the bound
-- keeps, and the generic plan was costed over every partition, so the plan
-- cache never took it and each call planned again (11.0 ms of planning in
-- production). vbn_siri_et_calls, the table under vbn_transit_delays_live, has
-- had btree (feed_ts) since 0243; there the probe is a backward walk of that
-- index in the partitions runtime pruning keeps, and the generic plan is
-- taken. This file gives vrn_transit_delays the same index, named the same way.
--
-- Not vbb_transit_delays, on purpose: the digest's VBB probe carries no
-- feed_ts bound (observed_at >= $1 alone), and with this index production
-- planned it as a backward feed_ts walk filtering every row on observed_at,
-- 380 ms a call instead of 8 ms; the index was dropped there again. VBB gets
-- the same index in a later migration once its probe carries the
-- "and feed_ts >= $1" bound VRN's and VBN's do (main repository, 2.6.32).
--
-- A partitioned parent cannot take create index concurrently, so the index is
-- made in three steps, none of which blocks a writer for longer than a
-- catalogue update:
--   1. the parent's index ON ONLY the parent: catalogue only, INVALID until
--      every partition has its index attached;
--   2. each partition's index built concurrently (SHARE UPDATE EXCLUSIVE,
--      blocks no writer), named as PostgreSQL names the one it clones;
--   3. each attached to the parent's index; with the last, the parent's index
--      turns VALID.
-- A day partition ensure_daily_partitions makes later (create table ... like,
-- then attach partition) gets the index cloned from the parent's at attach,
-- from step 1 on, so none is left without it.
--
-- rollback:
--   drop index if exists public.vrn_transit_delays_feed_ts;  -- drops every attached partition index with it
--   delete from schema_migrations where version = 318;

set max_parallel_maintenance_workers = 0;
set maintenance_work_mem = '64MB';

-- A partition index a failed concurrent build left INVALID (never attached: step 3 runs after it).
select format('drop index concurrently if exists %I.%I', n.nspname, i.relname)
  from pg_inherits h
  join pg_index x on x.indrelid = h.inhrelid
  join pg_class i on i.oid = x.indexrelid
  join pg_namespace n on n.oid = i.relnamespace
 where h.inhparent = 'public.vrn_transit_delays'::regclass
   and not x.indisvalid
   and i.relname = (select p.relname from pg_class p where p.oid = h.inhrelid) || '_feed_ts_idx'
\gexec

-- 1. The parent's index, catalogue only.
begin;
set local lock_timeout = '5s';
create index if not exists vrn_transit_delays_feed_ts on only public.vrn_transit_delays (feed_ts);
commit;

-- 2. Each partition without an index attached to the parent's: built concurrently.
select format('create index concurrently if not exists %I on %I.%I (feed_ts)', p.relname || '_feed_ts_idx', n.nspname, p.relname)
  from (values ('public.vrn_transit_delays'::regclass, 'public.vrn_transit_delays_feed_ts'::regclass)) t (parent, ix)
  join pg_inherits h on h.inhparent = t.parent
  join pg_class p on p.oid = h.inhrelid
  join pg_namespace n on n.oid = p.relnamespace
 where not exists (
         select 1 from pg_index x join pg_inherits a on a.inhrelid = x.indexrelid
          where x.indrelid = p.oid and a.inhparent = t.ix)
 order by p.relname
\gexec

-- 3. Each attached, one statement (and one short lock) per partition; the parent's index turns VALID with the last.
set lock_timeout = '5s';
select format('alter index %s attach partition %I.%I', t.ix, n.nspname, p.relname || '_feed_ts_idx')
  from (values ('public.vrn_transit_delays'::regclass, 'public.vrn_transit_delays_feed_ts'::regclass)) t (parent, ix)
  join pg_inherits h on h.inhparent = t.parent
  join pg_class p on p.oid = h.inhrelid
  join pg_namespace n on n.oid = p.relnamespace
 where not exists (
         select 1 from pg_index x join pg_inherits a on a.inhrelid = x.indexrelid
          where x.indrelid = p.oid and a.inhparent = t.ix)
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
   where c.oid = 'public.vrn_transit_delays_feed_ts'::regclass
     and not x.indisvalid;
  if bad is not null then
    raise exception 'vrn_transit_delays feed_ts: % still INVALID — a partition index is missing or not attached', bad;
  end if;
end
$$;
