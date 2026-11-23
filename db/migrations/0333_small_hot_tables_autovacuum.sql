-- Small tables rewritten by every tick: autovacuum and autoanalyze at their
-- own size, not at the default 50 rows + 10/20 %.
--
-- Root cause. Each autovacuum or autoanalyze of a table changes its relcache
-- entry, and every cached plan that reads the table — every connection's named
-- statement — is rebuilt on its next call. public.feed_checks, the view every
-- freshness read goes through (the digest's road, roadworks, parking and map
-- reads among them), reads three tables of fixed keys that the workers rewrite
-- in place (HOT) all day; at the defaults a table of a few hundred rows is
-- analysed after about 60-90 changed rows, which production reached every one
-- to two minutes. Production 2026-11-23, read only (rows, updates, autoanalyses,
-- autovacuums):
--   control.budget_state     49  1 812 641  11 669  11 343
--   public.source_schedule  100    273 275   3 669   3 536
--   control.feed_state      368    187 333   2 038   1 702
--   public.gbfs_systems     105    214 219   3 001   2 397  (gbfs_stations_live, gbfs_vehicles_live)
--   public.road_event_twins  77  55 564 inserted + 55 553 deleted, 738 / 888
--                                 (the digest's newest-per-road reads)
--  - a probe session holding seven prepared statements over 150 s rebuilt the
--    one through feed_checks twice and the one through gbfs_stations_live once,
--    and none over road events, roadworks or TMC locations;
--  - in a 90 s window the named digest statements that read feed_checks made
--    782 of the 1 343 plans of all named statements that planned again
--    (25.8 of 34.0 plan ms/s), each about once per connection per 90 s.
-- The statistics of a table of fixed keys do not move with its updates, so they
-- are taken once in tens of thousands of changes; page pruning keeps the HOT
-- chains short between vacuums. road_event_twins is insert-and-delete churn, so
-- it is vacuumed sooner (2 000 dead or inserted rows, as 0326 does for the
-- charging twin pairs).
--
-- rollback:
--   alter table control.feed_state reset (autovacuum_vacuum_scale_factor, autovacuum_vacuum_threshold,
--     autovacuum_analyze_scale_factor, autovacuum_analyze_threshold);
--   alter table public.gbfs_systems reset (autovacuum_vacuum_scale_factor, autovacuum_vacuum_threshold,
--     autovacuum_analyze_scale_factor, autovacuum_analyze_threshold);
--   alter table control.budget_state reset (autovacuum_vacuum_scale_factor, autovacuum_vacuum_threshold,
--     autovacuum_analyze_scale_factor, autovacuum_analyze_threshold);
--   alter table public.source_schedule reset (autovacuum_vacuum_scale_factor, autovacuum_vacuum_threshold,
--     autovacuum_analyze_scale_factor, autovacuum_analyze_threshold);
--   alter table public.road_event_twins reset (autovacuum_vacuum_scale_factor, autovacuum_vacuum_threshold,
--     autovacuum_vacuum_insert_scale_factor, autovacuum_vacuum_insert_threshold,
--     autovacuum_analyze_scale_factor, autovacuum_analyze_threshold);
--   delete from schema_migrations where version = 333;

set local lock_timeout = '5s';

alter table control.feed_state set (
  autovacuum_vacuum_scale_factor = 0,
  autovacuum_vacuum_threshold = 5000,
  autovacuum_analyze_scale_factor = 0,
  autovacuum_analyze_threshold = 20000
);

alter table public.gbfs_systems set (
  autovacuum_vacuum_scale_factor = 0,
  autovacuum_vacuum_threshold = 5000,
  autovacuum_analyze_scale_factor = 0,
  autovacuum_analyze_threshold = 20000
);

alter table control.budget_state set (
  autovacuum_vacuum_scale_factor = 0,
  autovacuum_vacuum_threshold = 5000,
  autovacuum_analyze_scale_factor = 0,
  autovacuum_analyze_threshold = 20000
);

alter table public.source_schedule set (
  autovacuum_vacuum_scale_factor = 0,
  autovacuum_vacuum_threshold = 5000,
  autovacuum_analyze_scale_factor = 0,
  autovacuum_analyze_threshold = 20000
);

alter table public.road_event_twins set (
  autovacuum_vacuum_scale_factor = 0,
  autovacuum_vacuum_threshold = 2000,
  autovacuum_vacuum_insert_scale_factor = 0,
  autovacuum_vacuum_insert_threshold = 2000,
  autovacuum_analyze_scale_factor = 0,
  autovacuum_analyze_threshold = 20000
);
