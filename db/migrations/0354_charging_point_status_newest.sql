-- public.charging_point_status_newest: the newest status tick of each charging
-- point and feed, kept by the tick table's own triggers.
--
-- The charging "near a point" reads look up each point's newest status in the
-- day-partitioned public.charging_point_status, a lateral "where evse_id = $k
-- and observed_at in the window order by observed_at desc limit 1". Most open
-- points get no status on a given day, so for most of them that walk probes
-- every day partition of the window and finds nothing until the last
-- (production 2026-11-28: ~0.2 ms a point, ~15 ms of a ~54 ms read at Köln
-- 25 km). This table holds that one row per (evse_id, source_feed), so the
-- lookup is one primary-key probe.
--
-- Columns: those of charging_point_status_live, the readers' view of the
-- ticks, in its order; the tick's raw record, site and station are not
-- carried. A reader still applies its own time window, the feed list and the
-- publisher's confidentiality to the row it finds, as it does to the tick.
--
-- Kept by two row triggers on the partitioned table. A row trigger of a
-- partitioned table is cloned to every partition, existing and future
-- (ensure_daily_partitions' create table ... like, then attach partition, and
-- an archived day attached back), so a row inserted into any day partition,
-- through the parent or directly, fires it:
--   charging_point_status_newest_note, after insert: the tick replaces the
--     feed's row of the point only when it is newer (observed_at greater); an
--     equal or older tick never overwrites it;
--   charging_point_status_newest_restate, after update or delete: when the
--     changed tick was the row held, the row is taken again from the ticks
--     left (none left, no row); an update's new tick is then noted as an
--     insert is. The writers only append (an update or a delete is a test's
--     or a hand repair's), as charging_status_runs' triggers assume too.
-- Retention retires a whole day partition (detach, archive, drop), which fires
-- no row trigger: a point's newest row stays even when it is older than the
-- retained days. That is wanted; the reader's own window decides whether the
-- row still counts.
--
-- evse_id is not null in the tick table, so no tick without one reaches the
-- triggers.
--
-- The rows the ticks already hold are filled by 0355, in a transaction of its
-- own after this file's commit: from that commit on every insert notes its
-- tick, so the fill, whose snapshot is taken later, sees every tick the
-- triggers did not note, and with the same newer-wins rule it never replaces a
-- newer row a trigger wrote meanwhile. Creating the triggers takes SHARE ROW
-- EXCLUSIVE on the table and each partition and waits for the writers' open
-- transactions (whose ticks the fill then sees); held for this file's
-- catalogue work only, not for the fill's scan of every partition.
--
-- Read by: api_reader and viafrei_mcp the table, as they read
-- charging_point_status; viafrei_digest the owner-rights view
-- charging_point_status_newest_live, as it reads charging_point_status_live.
--
-- rollback:
--   drop view if exists public.charging_point_status_newest_live;
--   drop trigger if exists charging_point_status_newest_note on public.charging_point_status;
--   drop trigger if exists charging_point_status_newest_restate on public.charging_point_status;
--   drop function if exists public.charging_point_status_newest_note(), public.charging_point_status_newest_restate();
--   drop table if exists public.charging_point_status_newest;
--   delete from schema_migrations where version = 354;

set local lock_timeout = '5s';

CREATE TABLE public.charging_point_status_newest (
    evse_id text NOT NULL,
    observed_at timestamp with time zone NOT NULL,
    feed_ts timestamp with time zone,
    last_updated timestamp with time zone,
    source_feed text NOT NULL,
    status text,
    operation_status text,
    opening_status text,
    exchange_protocol text,
    confidentiality text,
    source_run_id bigint,
    CONSTRAINT charging_point_status_newest_pkey PRIMARY KEY (evse_id, source_feed)
);

COMMENT ON TABLE public.charging_point_status_newest IS 'The newest charging_point_status tick of each (evse_id, source_feed), the columns of charging_point_status_live; kept by the tick table''s row triggers (newer observed_at wins), never pruned by retention (0354).';

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

COMMENT ON FUNCTION public.charging_point_status_newest_note() IS 'After insert on charging_point_status, each row: the tick becomes its point''s and feed''s charging_point_status_newest row when it is newer than the row held (0354).';

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

COMMENT ON FUNCTION public.charging_point_status_newest_restate() IS 'After update or delete on charging_point_status, each row: a changed tick that was its point''s and feed''s charging_point_status_newest row is replaced by the newest tick left; an update''s new tick is noted as an insert is (0354).';

CREATE TRIGGER charging_point_status_newest_note AFTER INSERT ON public.charging_point_status FOR EACH ROW EXECUTE FUNCTION public.charging_point_status_newest_note();
CREATE TRIGGER charging_point_status_newest_restate AFTER UPDATE OR DELETE ON public.charging_point_status FOR EACH ROW EXECUTE FUNCTION public.charging_point_status_newest_restate();

CREATE VIEW public.charging_point_status_newest_live AS
 SELECT evse_id,
    observed_at,
    feed_ts,
    last_updated,
    source_feed,
    status,
    operation_status,
    opening_status,
    exchange_protocol,
    confidentiality,
    source_run_id
   FROM public.charging_point_status_newest t;

COMMENT ON VIEW public.charging_point_status_newest_live IS 'The newest status tick of each charging point and feed for the place cards, as charging_point_status_live gives the ticks: the digest role reads it, never the table (0354).';

GRANT SELECT ON TABLE public.charging_point_status_newest TO api_reader;
GRANT SELECT ON TABLE public.charging_point_status_newest TO viafrei_mcp;
GRANT SELECT ON TABLE public.charging_point_status_newest_live TO viafrei_digest;
