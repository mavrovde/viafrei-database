-- The maintenance the application ran against this schema itself, as functions
-- and storage parameters of the schema (owner 2026-11-19: "all database
-- processing is located on the database project"). The applications call
-- these instead of issuing the statements.
--
-- 1 public.gtfs_derived_refresh(view): one of the three views built from the
--   GTFS timetable after a committed load, refreshed CONCURRENTLY under that
--   view's build session (the main repository's platform/db-memory.ts, in
--   force on 2026-11-19): serial, hash_mem_multiplier 1, jit off,
--   temp_file_limit 6GB, and work_mem as the build budget of 82 MB over the
--   plan nodes that hold it at once, never under 16 MB:
--     gtfs_untimed_trips 82MB (1 node), gtfs_route_kreise 27MB (3),
--     transit_stop_modes 16MB (5).
--   ONE view per call, on purpose: the caller refreshes the three one after
--   the other, each in its own transaction, and a failed one leaves the
--   others to run (and its own previous rows in place). One function over
--   all three would put them in one transaction, holding each view's lock to
--   the end and letting one failure roll back the others. The order the
--   caller keeps: gtfs_untimed_trips, gtfs_route_kreise, transit_stop_modes.
--   The settings are the function's own (SET clauses, restored when it
--   returns), so nothing leaks into the caller's session. It returns the
--   statement and the settings it ran under, a line for the caller's log.
-- 2 public.osm_street_tiles_refresh(view): osm_street_tiles, then
--   osm_street_tiles_lo, one per call for the same reason (each attempted
--   whatever the other did), CONCURRENTLY, on the server's settings.
--   A function cannot bound its own statement: statement_timeout is armed
--   when the caller's statement starts. The caller keeps the bound it has
--   today (600s per GTFS view, 300s per street view).
-- 3 public.analyze_after_load(variadic tables): ANALYZE of the tables the
--   bulk loaders refresh the statistics of after a load, and of nothing else:
--   gtfs_service_dates, routes, stops, trips, stop_times (the GTFS load and
--   its post-commit maintenance), osm_addresses, osm_pois (the address
--   load), osm_streets (the streets load), osm_speed_cameras (the camera
--   load). Any other name refuses the whole call before anything is
--   analysed. Several tables are one ANALYZE statement, as the GTFS
--   maintenance runs it. Usable inside the caller's transaction (the GTFS
--   load analyses trips and stop_times in its own).
-- 4 energy_page_keys: autovacuum's storage parameters for its churn, so the
--   writer no longer runs VACUUM itself. Each refresh of a kind inserts the
--   new generation and deletes the one before it (production, 2026-11-19:
--   191 592 live rows, two generations per kind; a charging refresh 83 k rows
--   in and 83 k out, a fuel refresh 12 k): a vacuum and an analyze are due
--   after EVERY refresh and never in between. A fixed threshold of 5 000
--   changed rows (no scale factor) fires on both kinds and on nothing else;
--   the insert threshold has autovacuum set the visibility map of a new
--   generation, which the sitemap's index-only reads need; cost delay 0
--   because the table is ~40 MB and a throttled pass would leave the dead
--   generation for minutes. Before this file the scale factor was 0.05
--   (about 9 600 rows), reached by a charging refresh alone.
--
-- The three functions are SECURITY DEFINER, owned by the owner role that
-- migrates (it owns the views and tables), so viafrei_ingestor can run them
-- too; PUBLIC cannot. search_path is fixed.
--
-- rollback:
--   drop function public.gtfs_derived_refresh(text), public.osm_street_tiles_refresh(text),
--     public.analyze_after_load(text[]);
--   alter table public.energy_page_keys reset (autovacuum_vacuum_threshold,
--     autovacuum_analyze_scale_factor, autovacuum_analyze_threshold,
--     autovacuum_vacuum_insert_scale_factor, autovacuum_vacuum_insert_threshold,
--     autovacuum_vacuum_cost_delay);
--   alter table public.energy_page_keys set (autovacuum_vacuum_scale_factor = 0.05);
--   delete from schema_migrations where version = 322;

set local lock_timeout = '5s';

CREATE FUNCTION public.gtfs_derived_refresh(p_view text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    SET max_parallel_workers_per_gather TO '0'
    SET hash_mem_multiplier TO '1'
    SET jit TO 'off'
    SET temp_file_limit TO '6GB'
    SET work_mem TO '16MB'
    AS $$
declare
  mem text;
begin
  mem := case p_view
           when 'gtfs_untimed_trips' then '82MB'
           when 'gtfs_route_kreise' then '27MB'
           when 'transit_stop_modes' then '16MB'
         end;
  if mem is null then
    raise exception 'gtfs_derived_refresh: % is not one of gtfs_untimed_trips, gtfs_route_kreise, transit_stop_modes', coalesce(p_view, 'NULL')
      using errcode = '22023';
  end if;
  perform set_config('work_mem', mem, true);
  execute format('refresh materialized view concurrently public.%I', p_view);
  return format('refresh materialized view concurrently public.%s (work_mem %s, hash_mem_multiplier %s, max_parallel_workers_per_gather %s, jit %s, temp_file_limit %s)',
                p_view, current_setting('work_mem'), current_setting('hash_mem_multiplier'),
                current_setting('max_parallel_workers_per_gather'), current_setting('jit'), current_setting('temp_file_limit'));
end $$;

CREATE FUNCTION public.osm_street_tiles_refresh(p_view text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
begin
  if p_view is null or p_view not in ('osm_street_tiles', 'osm_street_tiles_lo') then
    raise exception 'osm_street_tiles_refresh: % is not one of osm_street_tiles, osm_street_tiles_lo', coalesce(p_view, 'NULL')
      using errcode = '22023';
  end if;
  execute format('refresh materialized view concurrently public.%I', p_view);
end $$;

CREATE FUNCTION public.analyze_after_load(VARIADIC p_tables text[]) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  allowed constant text[] := array['gtfs_service_dates', 'routes', 'stops', 'trips', 'stop_times',
                                   'osm_addresses', 'osm_pois', 'osm_streets', 'osm_speed_cameras'];
  bad text[];
begin
  if p_tables is null or cardinality(p_tables) = 0 then
    raise exception 'analyze_after_load: name at least one table' using errcode = '22023';
  end if;
  select array_agg(coalesce(t, 'NULL')) into bad from unnest(p_tables) t where t is null or not (t = any (allowed));
  if bad is not null then
    raise exception 'analyze_after_load: % not analysed here; the tables are %', array_to_string(bad, ', '), array_to_string(allowed, ', ')
      using errcode = '22023';
  end if;
  execute 'analyze ' || (select string_agg(format('public.%I', t), ', ' order by o) from unnest(p_tables) with ordinality u(t, o));
end $$;

COMMENT ON FUNCTION public.gtfs_derived_refresh(text) IS 'Refreshes ONE of gtfs_untimed_trips, gtfs_route_kreise, transit_stop_modes by a concurrent refresh under its build session (serial, hash_mem_multiplier 1, jit off, temp_file_limit 6GB, work_mem 82/27/16 MB). One view per call, each in its own transaction, in that order, after a committed GTFS load; the caller bounds it with statement_timeout (600s). Migration 0322.';
COMMENT ON FUNCTION public.osm_street_tiles_refresh(text) IS 'Refreshes ONE of osm_street_tiles, osm_street_tiles_lo by a concurrent refresh. One per call, in that order, after a streets load; the caller bounds it with statement_timeout (300s). Migration 0322.';
COMMENT ON FUNCTION public.analyze_after_load(text[]) IS 'ANALYZE of the named tables, in one statement, only from the bulk-loaded set (gtfs_service_dates, routes, stops, trips, stop_times, osm_addresses, osm_pois, osm_streets, osm_speed_cameras); any other name refuses the call before anything runs. Migration 0322.';

REVOKE ALL ON FUNCTION public.gtfs_derived_refresh(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.osm_street_tiles_refresh(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.analyze_after_load(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.gtfs_derived_refresh(text) TO viafrei_ingestor;
GRANT EXECUTE ON FUNCTION public.osm_street_tiles_refresh(text) TO viafrei_ingestor;
GRANT EXECUTE ON FUNCTION public.analyze_after_load(text[]) TO viafrei_ingestor;

ALTER TABLE public.energy_page_keys SET (
  autovacuum_vacuum_scale_factor = 0,
  autovacuum_vacuum_threshold = 5000,
  autovacuum_analyze_scale_factor = 0,
  autovacuum_analyze_threshold = 5000,
  autovacuum_vacuum_insert_scale_factor = 0,
  autovacuum_vacuum_insert_threshold = 5000,
  autovacuum_vacuum_cost_delay = 0
);
