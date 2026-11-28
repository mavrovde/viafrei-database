-- public.charging_point_status_newest: the newest status tick of each charging
-- point and feed, filled here from the ticks held; 0355 adds the triggers that
-- keep it.
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
-- fillfactor 80: every newer tick rewrites its row, and the free space lets
-- most of those updates stay on their page (HOT).
--
-- The fill: the newest tick of each (evse_id, source_feed) of every day
-- partition, one scan (on production ~6 M ticks for ~0.4 M rows). Nothing
-- else writes the table yet: it is created in this transaction, and 0355's
-- triggers come after this file's commit, so no writer ever waits on a row
-- the fill inserted. What waits on what while it runs:
--   - the fill holds ACCESS SHARE on charging_point_status and every partition
--     until commit; the status writers' inserts (ROW EXCLUSIVE) do not wait;
--   - retention (src/retain.ts) retires an archived day, which this table's
--     are, in one transaction: SHARE on the day, a count, a plain detach
--     (ACCESS EXCLUSIVE on the parent, lock_timeout 3s), then the drop. That
--     detach waits behind the fill, the writers queue behind the waiting
--     detach for those 3 s, and then it fails with 55P03: the day is reported
--     failed and the next retain run retries it. (A no-archive tick's
--     detach concurrently would wait behind the fill as well, up to 60 s a
--     phase.) Neither the detach nor the drop of a day touches this table;
--   - a tick a writer commits after the fill's snapshot is not seen here;
--     0355's catch-up takes it.
--
-- Read by: api_reader and viafrei_mcp the table, as they read
-- charging_point_status; viafrei_digest the owner-rights view
-- charging_point_status_newest_live, as it reads charging_point_status_live.
--
-- rollback:
--   drop view if exists public.charging_point_status_newest_live;
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
)
WITH (fillfactor = 80);

COMMENT ON TABLE public.charging_point_status_newest IS 'The newest charging_point_status tick of each (evse_id, source_feed), the columns of charging_point_status_live; filled by 0354, kept by the tick table''s row triggers (0355, the newer observed_at wins), never pruned by retention.';

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

insert into public.charging_point_status_newest
       (evse_id, observed_at, feed_ts, last_updated, source_feed, status, operation_status, opening_status, exchange_protocol, confidentiality, source_run_id)
select distinct on (t.evse_id, t.source_feed)
       t.evse_id, t.observed_at, t.feed_ts, t.last_updated, t.source_feed, t.status, t.operation_status, t.opening_status,
       t.exchange_protocol, t.confidentiality, t.source_run_id
  from public.charging_point_status t
 order by t.evse_id, t.source_feed, t.observed_at desc;
