-- stop_times (a plain table, about 48 million rows, 28 GB with its indexes)
-- holds the 48-hour timetable window; its loader deletes about two million
-- rows an hour. At the default scale factor (0.2) autovacuum waited for
-- about 9.5 million dead rows: production held 6.9 million on 2026-11-22
-- 08:35Z and was vacuumed by hand (11 minutes, throttled). 0.1 starts it at
-- about 4.3 million, roughly every two hours at today's churn; a cost limit
-- of 1000 (the default is vacuum_cost_limit, 200) lets each run finish in
-- minutes instead of most of the interval. Set by hand on production at
-- 08:48Z; this file makes it the schema's. Not lower: every run reads all
-- four indexes (about 22 GB) once, so a run an hour would cost more than the
-- dead rows it removes on a host that is CPU-bound in the day.
--
-- Lock: alter table ... set (autovacuum_...) takes SHARE UPDATE EXCLUSIVE,
-- which blocks no reader and no writer; lock_timeout bounds the wait for it
-- (rule 6) behind a running vacuum.
--
-- rollback:
--   alter table public.stop_times reset (autovacuum_vacuum_scale_factor, autovacuum_vacuum_cost_limit);
--   delete from schema_migrations where version = 324;

set local lock_timeout = '5s';

alter table public.stop_times set (autovacuum_vacuum_scale_factor = 0.1, autovacuum_vacuum_cost_limit = 1000);
