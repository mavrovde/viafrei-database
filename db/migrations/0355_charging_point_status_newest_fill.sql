-- Fills public.charging_point_status_newest (0354) from the ticks the day
-- partitions already hold: the newest tick of each (evse_id, source_feed).
--
-- A file of its own, after 0354's commit, so that no tick is lost and no
-- writer waits for the scan. From 0354's commit on, every insert notes its
-- tick through the row trigger; this statement's snapshot is taken after that
-- commit, so it sees every tick written before the triggers were there (0354
-- waited for those writers' transactions). Its conflict rule is the trigger's:
-- a tick replaces the row held only when it is newer, so a newer row a trigger
-- wrote while the fill ran is kept, and a second run is a no-op. The fill
-- takes ROW EXCLUSIVE on the new table and ACCESS SHARE on the ticks, which
-- block no writer; on production it scans every retained day once (~6 M ticks
-- for ~0.4 M rows).
--
-- rollback:
--   delete from public.charging_point_status_newest;  -- 0354's triggers fill it again from the next ticks on
--   delete from schema_migrations where version = 355;

set local lock_timeout = '5s';

insert into public.charging_point_status_newest as n
       (evse_id, observed_at, feed_ts, last_updated, source_feed, status, operation_status, opening_status, exchange_protocol, confidentiality, source_run_id)
select distinct on (t.evse_id, t.source_feed)
       t.evse_id, t.observed_at, t.feed_ts, t.last_updated, t.source_feed, t.status, t.operation_status, t.opening_status,
       t.exchange_protocol, t.confidentiality, t.source_run_id
  from public.charging_point_status t
 order by t.evse_id, t.source_feed, t.observed_at desc
on conflict (evse_id, source_feed) do update
   set observed_at = excluded.observed_at, feed_ts = excluded.feed_ts, last_updated = excluded.last_updated,
       status = excluded.status, operation_status = excluded.operation_status, opening_status = excluded.opening_status,
       exchange_protocol = excluded.exchange_protocol, confidentiality = excluded.confidentiality, source_run_id = excluded.source_run_id
 where excluded.observed_at > n.observed_at;
