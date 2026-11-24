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
set lock_timeout = '30s';
create index concurrently if not exists stop_times_stop on public.stop_times using btree (gtfs_feed_key, stop_id, trip_id);
reset lock_timeout;
