-- The four daily ticks of schema public that carried no BRIN on observed_at
-- get one, like every other daily tick (#31 round 2: the schema rule "BRIN on
-- observed_at"), and every public daily tick gets its retention row in
-- partition_retention, the table the domains ticks already use, so the window
-- each one keeps is a fact of the schema rather than only of viafrei's ingest.
--
-- The retention values are viafrei@4dd794ab0's:
--   packages/ingest/src/platform/tick-retention-policy.ts TICK_DROP_KEEP_DAYS —
--     the eight no-archive ticks, 1 day, dropped without a dump;
--   packages/ingest/src/platform/partition-archive.ts PARTITION_ARCHIVE_DAYS
--     (14) for every other daily tick, and PARTITION_ARCHIVE_TABLE_DAYS
--     fuel_prices 28 (the fuel sample's history window), dumped to the cold
--     store before the day is dropped.
-- ops_rollup_feed is not a tick and keeps its own 90 days (ops_rollup_refresh).
--
-- CREATE INDEX on a partitioned table builds the index on every partition in
-- this transaction; BRIN is a sequential read of each day and small. The
-- existing day partitions' BRIN indexes are set to autosummarize as
-- ensure_daily_partitions does for the days it makes.
--
-- rollback:
--   drop index public.db_facility_ticks_brin, public.los_ticks_brin,
--     public.station_equipment_ticks_brin, public.street_bay_ticks_brin;
--   delete from public.partition_retention where schema_name = 'public';
--   delete from schema_migrations where version = 305;

CREATE INDEX db_facility_ticks_brin ON public.db_facility_ticks USING brin (observed_at);
CREATE INDEX los_ticks_brin ON public.los_ticks USING brin (observed_at);
CREATE INDEX station_equipment_ticks_brin ON public.station_equipment_ticks USING brin (observed_at);
CREATE INDEX street_bay_ticks_brin ON public.street_bay_ticks USING brin (observed_at);

DO $$
DECLARE
  part regclass;
BEGIN
  FOR part IN
    SELECT i.inhrelid::regclass FROM pg_inherits i
     WHERE i.inhparent IN ('public.db_facility_ticks'::regclass, 'public.los_ticks'::regclass,
                           'public.station_equipment_ticks'::regclass, 'public.street_bay_ticks'::regclass)
  LOOP
    PERFORM public.tick_brin_autosummarize(part);
  END LOOP;
END $$;

INSERT INTO public.partition_retention (schema_name, table_name, keep_days, archive, reason) VALUES
  ('public', 'autobahn_events', 1, false, 'TICK_DROP_KEEP_DAYS (owner 2026-10-06, "keep 1 day"): today and yesterday on the Berlin calendar, then dropped with no archive; its readers need at most 30 minutes'),
  ('public', 'connect_transit_delays', 1, false, 'TICK_DROP_KEEP_DAYS: today and yesterday, then dropped with no archive'),
  ('public', 'delfi_siri_et_calls', 1, false, 'TICK_DROP_KEEP_DAYS: today and yesterday, then dropped with no archive; departures read 6 hours'),
  ('public', 'road_event_ticks', 1, false, 'TICK_DROP_KEEP_DAYS: today and yesterday, then dropped with no archive; no tool reads it, the live answer is road_events'),
  ('public', 'transit_delays', 1, false, 'TICK_DROP_KEEP_DAYS: today and yesterday, then dropped with no archive; its readers need at most 6 hours'),
  ('public', 'vbb_transit_delays', 1, false, 'TICK_DROP_KEEP_DAYS: today and yesterday, then dropped with no archive'),
  ('public', 'vbn_siri_et_calls', 1, false, 'TICK_DROP_KEEP_DAYS: today and yesterday, then dropped with no archive'),
  ('public', 'vrn_transit_delays', 1, false, 'TICK_DROP_KEEP_DAYS: today and yesterday, then dropped with no archive'),
  ('public', 'charging_point_status', 14, true, 'PARTITION_ARCHIVE_DAYS: 14 days, then the cold store, because a delta feed''s status cannot be fetched again'),
  ('public', 'city_traffic_ticks', 14, true, 'PARTITION_ARCHIVE_DAYS: 14 days, then the cold store'),
  ('public', 'db_facility_ticks', 14, true, 'PARTITION_ARCHIVE_DAYS: 14 days, then the cold store'),
  ('public', 'fuel_prices', 28, true, 'PARTITION_ARCHIVE_TABLE_DAYS: 28 days, the fuel sample''s history window, then the cold store'),
  ('public', 'gbfs_station_status', 14, true, 'PARTITION_ARCHIVE_DAYS: 14 days, then the cold store'),
  ('public', 'los_ticks', 14, true, 'PARTITION_ARCHIVE_DAYS: 14 days, then the cold store'),
  ('public', 'parking_occupancy', 14, true, 'PARTITION_ARCHIVE_DAYS: 14 days, then the cold store, because an occupancy feed offers each observation once'),
  ('public', 'parking_occupancy_sid', 14, true, 'PARTITION_ARCHIVE_DAYS: 14 days, then the cold store'),
  ('public', 'station_equipment_ticks', 14, true, 'PARTITION_ARCHIVE_DAYS: 14 days, then the cold store'),
  ('public', 'street_bay_ticks', 14, true, 'PARTITION_ARCHIVE_DAYS: 14 days, then the cold store'),
  ('public', 'traffic_count_ticks', 14, true, 'PARTITION_ARCHIVE_DAYS: 14 days, then the cold store');
