-- The two row triggers that keep public.charging_point_status_newest (0354)
-- current, and the catch-up of the ticks written between 0354's fill and
-- them.
--
-- A row trigger of a partitioned table is cloned to every partition, existing
-- and future (ensure_daily_partitions' create table ... like, then attach
-- partition, and an archived day attached back), so a row inserted into any
-- day partition, through the parent or directly, fires it:
--   charging_point_status_newest_note, after insert: the tick replaces the
--     feed's row of the point only when it is newer (observed_at greater); an
--     equal or older tick never overwrites it;
--   charging_point_status_newest_restate, after update or delete: when the
--     changed tick was the row held, the row is taken again from the ticks
--     left (none left, no row); an update's new tick is then noted as an
--     insert is. The writers only append (an update or a delete is a test's
--     or a hand repair's), as charging_status_runs' triggers assume too.
-- Retention (src/retain.ts) retires a whole day partition: detach
-- concurrently then drop (a no-archive tick), or detach then drop (an archived
-- one, as this). Neither fires a row trigger, so a point's newest row stays
-- even when it is older than the retained days. That is wanted; the reader's
-- own window decides whether the row still counts.
--
-- evse_id is not null in the tick table, so no tick without one reaches the
-- triggers.
--
-- The catch-up. 0354's fill saw the ticks committed before its snapshot; a
-- tick committed after it and before this file's triggers fired nothing. Its
-- observed_at is its writer's pull time, which is before its commit, so
-- after 0354's start (its applied_at, taken before the fill's snapshot) less
-- the writer's pull-to-commit time. The catch-up takes every tick from
-- 0354's applied_at less an hour on, under the triggers' newer-wins rule,
-- however long the migrator paused between the two files: the bound is
-- 0354's start, not this file's. A writer that holds a pulled tick for more
-- than an hour before its commit, across the migration, is the one case not
-- covered.
--
-- What waits on what. CREATE TRIGGER takes SHARE ROW EXCLUSIVE on the table
-- and on every partition (lock_timeout 5s: a writer's open transaction makes
-- it wait, and after 5 s it fails with 55P03 and migrate retries the file).
-- From the first lock until this file's commit the status writers' inserts
-- (ROW EXCLUSIVE) wait, and so does retention's detach; the catch-up runs
-- inside that window, so no tick can arrive between it and the triggers. It
-- reads the ticks of the last hour or so (BRIN on observed_at, one or two day
-- partitions) and upserts a few thousand rows: the writers wait for that
-- and for the catalogue work, not for a scan of every day. No other writer of
-- charging_point_status_newest exists while it runs (the triggers are not
-- committed yet), so its upserts wait on no row lock.
--
-- rollback:
--   drop trigger if exists charging_point_status_newest_note on public.charging_point_status;
--   drop trigger if exists charging_point_status_newest_restate on public.charging_point_status;
--   drop function if exists public.charging_point_status_newest_note(), public.charging_point_status_newest_restate();
--   delete from schema_migrations where version = 355;

set local lock_timeout = '5s';

CREATE FUNCTION public.charging_point_status_newest_note() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
begin
  insert into charging_point_status_newest as n
         (evse_id, observed_at, feed_ts, last_updated, source_feed, status, operation_status, opening_status, exchange_protocol, confidentiality, source_run_id)
  values (new.evse_id, new.observed_at, new.feed_ts, new.last_updated, new.source_feed, new.status, new.operation_status, new.opening_status,
          new.exchange_protocol, new.confidentiality, new.source_run_id)
  on conflict (evse_id, source_feed) do update
     set observed_at = excluded.observed_at, feed_ts = excluded.feed_ts, last_updated = excluded.last_updated,
         status = excluded.status, operation_status = excluded.operation_status, opening_status = excluded.opening_status,
         exchange_protocol = excluded.exchange_protocol, confidentiality = excluded.confidentiality, source_run_id = excluded.source_run_id
   where excluded.observed_at > n.observed_at;
  return null;
end
$$;

COMMENT ON FUNCTION public.charging_point_status_newest_note() IS 'After insert on charging_point_status, each row: the tick becomes its point''s and feed''s charging_point_status_newest row when it is newer than the row held (0355)';

CREATE FUNCTION public.charging_point_status_newest_restate() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
begin
  delete from charging_point_status_newest n
   where n.evse_id = old.evse_id and n.source_feed = old.source_feed and n.observed_at = old.observed_at;
  if found then
    insert into charging_point_status_newest as n
           (evse_id, observed_at, feed_ts, last_updated, source_feed, status, operation_status, opening_status, exchange_protocol, confidentiality, source_run_id)
    select t.evse_id, t.observed_at, t.feed_ts, t.last_updated, t.source_feed, t.status, t.operation_status, t.opening_status,
           t.exchange_protocol, t.confidentiality, t.source_run_id
      from charging_point_status t
     where t.evse_id = old.evse_id and t.source_feed = old.source_feed
     order by t.observed_at desc
     limit 1
    on conflict (evse_id, source_feed) do update
       set observed_at = excluded.observed_at, feed_ts = excluded.feed_ts, last_updated = excluded.last_updated,
           status = excluded.status, operation_status = excluded.operation_status, opening_status = excluded.opening_status,
           exchange_protocol = excluded.exchange_protocol, confidentiality = excluded.confidentiality, source_run_id = excluded.source_run_id
     where excluded.observed_at > n.observed_at;
  end if;
  if tg_op = 'UPDATE' then
    insert into charging_point_status_newest as n
           (evse_id, observed_at, feed_ts, last_updated, source_feed, status, operation_status, opening_status, exchange_protocol, confidentiality, source_run_id)
    values (new.evse_id, new.observed_at, new.feed_ts, new.last_updated, new.source_feed, new.status, new.operation_status, new.opening_status,
            new.exchange_protocol, new.confidentiality, new.source_run_id)
    on conflict (evse_id, source_feed) do update
       set observed_at = excluded.observed_at, feed_ts = excluded.feed_ts, last_updated = excluded.last_updated,
           status = excluded.status, operation_status = excluded.operation_status, opening_status = excluded.opening_status,
           exchange_protocol = excluded.exchange_protocol, confidentiality = excluded.confidentiality, source_run_id = excluded.source_run_id
     where excluded.observed_at > n.observed_at;
  end if;
  return null;
end
$$;

COMMENT ON FUNCTION public.charging_point_status_newest_restate() IS 'After update or delete on charging_point_status, each row: a changed tick that was its point''s and feed''s charging_point_status_newest row is replaced by the newest tick left; an update''s new tick is noted as an insert is (0355)';

CREATE TRIGGER charging_point_status_newest_note AFTER INSERT ON public.charging_point_status FOR EACH ROW EXECUTE FUNCTION public.charging_point_status_newest_note();
CREATE TRIGGER charging_point_status_newest_restate AFTER UPDATE OR DELETE ON public.charging_point_status FOR EACH ROW EXECUTE FUNCTION public.charging_point_status_newest_restate();

insert into public.charging_point_status_newest as n
       (evse_id, observed_at, feed_ts, last_updated, source_feed, status, operation_status, opening_status, exchange_protocol, confidentiality, source_run_id)
select distinct on (t.evse_id, t.source_feed)
       t.evse_id, t.observed_at, t.feed_ts, t.last_updated, t.source_feed, t.status, t.operation_status, t.opening_status,
       t.exchange_protocol, t.confidentiality, t.source_run_id
  from public.charging_point_status t
 where t.observed_at >= coalesce((select m.applied_at from schema_migrations m where m.version = 354), '-infinity'::timestamptz) - interval '1 hour'
 order by t.evse_id, t.source_feed, t.observed_at desc
on conflict (evse_id, source_feed) do update
   set observed_at = excluded.observed_at, feed_ts = excluded.feed_ts, last_updated = excluded.last_updated,
       status = excluded.status, operation_status = excluded.operation_status, opening_status = excluded.opening_status,
       exchange_protocol = excluded.exchange_protocol, confidentiality = excluded.confidentiality, source_run_id = excluded.source_run_id
 where excluded.observed_at > n.observed_at;
