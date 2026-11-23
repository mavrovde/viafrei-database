-- Every SECURITY DEFINER function and every trigger function runs under a
-- search_path of its own, with pg_temp listed last.
--
-- THE FAULT. 0338's trigger functions road_events_fill_land and
-- autobahn_events_fill_land name st_pointonsurface, geometry and geography
-- unqualified and set no search_path, so they resolve those names under the
-- caller's. pg_restore runs with search_path = '': restoring an archived day
-- partition of autobahn_events (pre-data, then data: the ATTACH gives the new
-- partition the parent's row triggers, and the COPY fires them) fails with
--   ERROR: type "geography" does not exist
--   CONTEXT: PL/pgSQL function public.autobahn_events_fill_land() line 3
-- and the day is not back. Sixteen other trigger functions of public set no
-- search_path either; any of them on a table a restore or a client with
-- another search_path writes fails, or resolves a name to another schema's
-- object, the same way.
--
-- THE SECOND FAULT. A function that names no pg_temp in its search_path
-- searches the session's temporary schema FIRST for tables, views and types.
-- For a SECURITY DEFINER function that is a privilege escalation: a caller
-- creates a temporary table or view with the name of a table the function
-- reads, and the function, running as its owner, reads or writes the caller's
-- object instead. Ten SECURITY DEFINER functions list no pg_temp; three
-- trigger functions likewise.
--
-- THE FIX. Forward only, no released file is edited:
--   - the two 0338 trigger functions again, every name schema-qualified
--     (public.st_pointonsurface, public.geometry, public.geography), and set
--     search_path = pg_catalog, public, pg_temp;
--   - refresh_event_land (0338) again with qualified names. A procedure with a
--     SET clause may not COMMIT, and this one commits each chunk, so it takes
--     no search_path: its body names only public.* and pg_catalog objects, and
--     it is neither SECURITY DEFINER nor a trigger;
--   - the sixteen other unpinned trigger functions: set search_path =
--     pg_catalog, public, pg_temp. Each lives in public and its body names only
--     public and pg_catalog objects (read from the catalogue at 0338: no name
--     in its text exists only in another schema), so under the database-wide
--     path ("$user", public, topology, tiger; no role has a schema of its name)
--     it resolved every name to the object it resolves now;
--   - the thirteen pinned functions without pg_temp: the same list, pg_temp
--     appended.
-- ALTER FUNCTION ... SET keeps the body, the owner, the grants and the comment.
-- None of these is a SQL function a planner inlines (a SET clause stops
-- inlining): the ones of language sql here were SET already.
--
-- Cost: a function with a SET clause saves and restores the setting on each
-- call, microseconds a row on the tick tables' row triggers.
--
-- rollback:
--   alter function <each function below> reset search_path, for the sixteen
--   trigger functions and the two 0338 ones; for the thirteen others set the
--   search_path back to the list without pg_temp; the two 0338 functions and
--   refresh_event_land as 0338 creates them (create or replace, its text);
--   delete from schema_migrations where version = 339;

set local lock_timeout = '5s';

-- 0338's DATEX II branch, qualified and pinned.
create or replace function public.road_events_fill_land()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  new.land_code := public.contract_junction_land(public.st_pointonsurface(new.geom)::public.geometry(Point,4326)::public.geography);
  return new;
end
$function$;

-- 0338's Autobahn branch, qualified and pinned.
create or replace function public.autobahn_events_fill_land()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  new.land_code := public.contract_junction_land(public.st_pointonsurface(new.geom::public.geometry)::public.geometry(Point,4326)::public.geography);
  return new;
end
$function$;

-- 0338's fill, qualified (no SET: it commits).
create or replace procedure public.refresh_event_land(p_batch integer default 2000)
language plpgsql
as $procedure$
declare
  after_id bigint := 0;
  last_id bigint;
begin
  if p_batch is null or p_batch < 1 then
    raise exception 'refresh_event_land: p_batch must be at least 1, got %', p_batch;
  end if;
  loop
    perform pg_catalog.set_config('lock_timeout', '5s', true);
    with b as (
      select e.id from public.road_events e
       where e.id > after_id
       order by e.id
       limit p_batch
    ), u as (
      update public.road_events e
         set land_code = x.land
        from (select b.id, public.contract_junction_land(public.st_pointonsurface(r.geom)::public.geometry(Point,4326)::public.geography) as land
                from b join public.road_events r on r.id = b.id) x
       where e.id = x.id and e.land_code is distinct from x.land
    )
    select pg_catalog.max(b.id) into last_id from b;
    exit when last_id is null;
    after_id := last_id;
    commit;
  end loop;
end
$procedure$;

-- The other trigger functions that set no search_path.
alter function public.autobahn_events_reset_derived() set search_path = pg_catalog, public, pg_temp;
alter function public.charging_status_runs_note() set search_path = pg_catalog, public, pg_temp;
alter function public.charging_status_runs_recompute() set search_path = pg_catalog, public, pg_temp;
alter function public.fuel_stations_set_land() set search_path = pg_catalog, public, pg_temp;
alter function public.lez_zones_overlaps_trigger() set search_path = pg_catalog, public, pg_temp;
alter function public.ops_audit_append_only() set search_path = pg_catalog, public, pg_temp;
alter function public.ops_passkeys_cap() set search_path = pg_catalog, public, pg_temp;
alter function public.ops_passkeys_counter() set search_path = pg_catalog, public, pg_temp;
alter function public.ops_requests_rate_limit() set search_path = pg_catalog, public, pg_temp;
alter function public.place_slugs_frozen() set search_path = pg_catalog, public, pg_temp;
alter function public.road_events_fill_entry_static() set search_path = pg_catalog, public, pg_temp;
alter function public.road_events_note_suspended() set search_path = pg_catalog, public, pg_temp;
alter function public.station_slugs_frozen() set search_path = pg_catalog, public, pg_temp;
alter function public.vf_postcode_normalise() set search_path = pg_catalog, public, pg_temp;
alter function public.watch_events_notify() set search_path = pg_catalog, public, pg_temp;
alter function public.watches_enforce_session_limit() set search_path = pg_catalog, public, pg_temp;

-- SECURITY DEFINER functions whose path lists no pg_temp (searched first): appended.
alter function access.prune_audit(timestamptz) set search_path = pg_catalog, access, pg_temp;
alter function access.prune_usage(integer) set search_path = pg_catalog, access, pg_temp;
alter function ingestor.project_run(bigint) set search_path = pg_catalog, public, pg_temp;
alter function ingestor.register_feed(text, text, text, text, text, text, integer, integer, boolean, text) set search_path = pg_catalog, public, pg_temp;
alter function ingestor.taken_feed_keys(text[]) set search_path = pg_catalog, public, pg_temp;
alter function live.prune_refresh_requests(timestamptz) set search_path = pg_catalog, live, pg_temp;
alter function public.autobahn_sweeps_note() set search_path = pg_catalog, public, pg_temp;
alter function public.contract_junction_land(public.geography) set search_path = pg_catalog, public, pg_temp;
alter function public.contract_road_shape(text) set search_path = pg_catalog, public, pg_temp;
alter function public.contract_stop_place_of(text) set search_path = pg_catalog, public, pg_temp;

-- Trigger functions (invoker) whose path lists no pg_temp: appended, one rule for all.
alter function domains.road_events_note_suspended() set search_path = pg_catalog, public, pg_temp;
alter function live.refresh_requests_notify() set search_path = pg_catalog, live, pg_temp;
alter function live.refresh_requests_transition() set search_path = pg_catalog, live, pg_temp;
