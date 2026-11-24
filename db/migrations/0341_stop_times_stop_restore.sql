-- no-transaction: builds an index with create index concurrently, which
-- PostgreSQL refuses inside a transaction block. Idempotent: if not exists, so
-- a database where the index was already built again by hand (production,
-- 2026-11-24) is left as it is.
--
-- stop_times_stop (gtfs_feed_key, stop_id, trip_id) comes back. 0325 dropped
-- it on the reading that stop_times' (gtfs_feed_key, stop_id) reads plan
-- through stop_times_stop_tod and stop_times_stop_arr_tod. They cannot: both
-- are partial (departure, or arrival, is not null), and a read that asks only
-- whether a stop has times, with no predicate on either column, is not implied
-- by either. Five reads of the platform's departures tool ask exactly that
-- (among them the name lookup's timetable probe). Without the index each is
-- a sequential scan of stop_times (19 M rows): production, 2026-11-24,
-- the name lookup for "Hamburg Hbf" over 60 s, against 0.9 s on the partial
-- index with the predicate added; the tool timed out on 6 of 13 calls.
--
-- rollback:
--   drop index concurrently if exists public.stop_times_stop;
--   delete from schema_migrations where version = 341;
-- An INVALID index under the name (a build that timed out, here or by hand)
-- is dropped first; 'if not exists' would otherwise keep it and the ledger
-- would record the file as applied.
set lock_timeout = '30s';
set max_parallel_maintenance_workers = 0;
set maintenance_work_mem = '256MB';
select format('drop index concurrently if exists public.%I', i.relname)
  from pg_class i
  join pg_index x on x.indexrelid = i.oid
 where i.relnamespace = 'public'::regnamespace
   and not x.indisvalid
   and i.relname = 'stop_times_stop'
\gexec
create index concurrently if not exists stop_times_stop on public.stop_times using btree (gtfs_feed_key, stop_id, trip_id);
reset lock_timeout;
reset maintenance_work_mem;
reset max_parallel_maintenance_workers;
