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
-- 23 of these functions are defined again here in full: create or replace,
-- their newest text verbatim (the file named above each), the search_path
-- clause the only change. They are the ones the mutation set plants faults
-- in, and a mutant must sit in the definition a migrated database carries
-- (test/mutants.test.ts), which is now this file's. The other six take
-- ALTER FUNCTION ... SET. Either way the body, the owner, the grants and the
-- comment stay. None of these is a SQL function a planner inlines (a SET
-- clause stops inlining): the ones of language sql here were SET already.
--
-- Cost: a function with a SET clause saves and restores the setting on each
-- call, microseconds a row on the tick tables' row triggers.
--
-- rollback:
--   alter function <each function below> reset search_path, for the sixteen
--   trigger functions and the two 0338 ones; for the thirteen others set the
--   search_path back to the list without pg_temp (the 23 defined in full here
--   included: an alter of the setting gives back their earlier definition,
--   whose body this file does not change); the two 0338 functions and
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

-- Every function a mutant of an earlier file plants its fault in is defined here again,
-- its newest text verbatim (the file it is copied from named above it), with
-- create or replace and its search_path pinned; the function's body is unchanged.
-- ingestor.project_run, from 0293_baseline.sql.
CREATE OR REPLACE FUNCTION ingestor.project_run(p_run_id bigint) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
declare r ingestor.runs; s ingestor.source_state; v text;
begin
  select * into r from ingestor.runs where id = p_run_id for update;
  if r.id is null then raise exception 'ingestor.project_run: no run %', p_run_id; end if;
  if r.status = 'running' then raise exception 'ingestor.project_run: run % is still running', p_run_id; end if;
  if r.source_id is distinct from current_setting('viafrei.source_id', true) then
    raise exception 'ingestor.project_run: run % belongs to %, not to this transaction''s source', p_run_id, r.source_id
      using errcode = '42501';
  end if;
  if not exists (select 1 from public.feed_catalog c where c.feed_key = r.source_id and c.published_by = 'ingestor') then
    raise exception 'ingestor.project_run: feed_key % is not a feed the ingestor registered', r.source_id
      using errcode = '42501';
  end if;
  if r.projected_at is not null then raise exception 'ingestor.project_run: run % is already projected', p_run_id; end if;
  update ingestor.runs set projected_at = clock_timestamp() where id = p_run_id;
  select * into s from ingestor.source_state where source_id = r.source_id;
  select registered_by into v from ingestor.sources where id = r.source_id;
  insert into public.feed_runs (feed_key, started_at, finished_at, status, http_status, bytes, etag, last_modified, raw_path,
                                items_seen, items_changed, items_inserted, items_updated, items_closed, error, duration_ms,
                                note, worker_version, next_due_at)
  values (r.source_id, r.started_at, r.finished_at,
          case r.status when 'partial' then 'degraded' when 'limited' then 'held' else r.status end,
          r.http_status, r.bytes, s.etag, s.last_modified, r.raw_path,
          r.fetched, coalesce(r.inserted, 0) + coalesce(r.updated, 0) + coalesce(r.closed, 0), r.inserted, r.updated, r.closed,
          case when r.error_class is null then null else r.error_class || ': ' || left(r.error_message, 400) end,
          r.duration_ms, 'ingest unit ' || coalesce(r.unit, '?') || ' instance ' || coalesce(r.pod, '?'),
          v, s.next_due_at);
end $$;

-- ingestor.register_feed, from 0293_baseline.sql.
CREATE OR REPLACE FUNCTION ingestor.register_feed(p_feed_key text, p_display_name text, p_provider text, p_licence_id text, p_licence_label text, p_attribution text, p_cadence_s integer, p_min_interval_s integer, p_enabled boolean, p_registry_version text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
begin
  if not exists (select 1 from ingestor.sources s where s.id = p_feed_key) then
    raise exception 'ingestor.register_feed: % is not a registered ingestor source', p_feed_key;
  end if;
  if exists (select 1 from public.feed_catalog c where c.feed_key = p_feed_key and c.published_by is distinct from 'ingestor') then
    raise exception 'ingestor.register_feed: feed_key % belongs to another publisher', p_feed_key;
  end if;
  insert into public.feed_catalog as c (feed_key, provider, display_name, licence_id, licence_label, attribution,
                                        format, cadence_s, min_interval_s, enabled, registry_version, published_by, updated_at, closed_at)
  values (p_feed_key, p_provider, p_display_name, p_licence_id, p_licence_label, p_attribution,
          'ingestor', p_cadence_s, p_min_interval_s, p_enabled, p_registry_version, 'ingestor', clock_timestamp(), null)
  on conflict (feed_key) do update
     set provider = excluded.provider, display_name = excluded.display_name, licence_id = excluded.licence_id,
         licence_label = excluded.licence_label, attribution = excluded.attribution, cadence_s = excluded.cadence_s,
         min_interval_s = excluded.min_interval_s, enabled = excluded.enabled, registry_version = excluded.registry_version,
         updated_at = clock_timestamp(), closed_at = null
   where c.published_by = 'ingestor';
end $$;

-- ingestor.taken_feed_keys, from 0293_baseline.sql.
CREATE OR REPLACE FUNCTION ingestor.taken_feed_keys(p_ids text[]) RETURNS SETOF text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
  select c.feed_key from public.feed_catalog c
   where c.feed_key = any(p_ids) and c.published_by is distinct from 'ingestor'
   order by 1
$$;

-- public.road_events_note_suspended, from 0293_baseline.sql.
CREATE OR REPLACE FUNCTION public.road_events_note_suspended() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
begin
  new.suspended := road_event_suspended(new.payload);
  return new;
end
$$;

-- public.ops_audit_append_only, from 0293_baseline.sql.
CREATE OR REPLACE FUNCTION public.ops_audit_append_only() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
begin
  if tg_op = 'UPDATE'
     and old.at < now() - interval '12 months'
     and old.client_ip is not null
     and new.client_ip is null
     and (to_jsonb(new) - 'client_ip') = (to_jsonb(old) - 'client_ip')
  then
    return new;
  end if;
  raise exception 'ops_audit is append-only: % refused', tg_op using errcode = 'P0001';
end $$;

-- public.ops_passkeys_cap, from 0293_baseline.sql.
CREATE OR REPLACE FUNCTION public.ops_passkeys_cap() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
begin
  perform pg_advisory_xact_lock(hashtext('ops_passkeys_cap'));
  if (select count(*) from ops_passkeys) >= 10 then
    raise exception 'ops_passkeys holds at most ten passkeys' using errcode = 'P0001';
  end if;
  return new;
end $$;

-- public.ops_passkeys_counter, from 0293_baseline.sql.
CREATE OR REPLACE FUNCTION public.ops_passkeys_counter() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
begin
  if new.sign_count < old.sign_count then
    raise exception 'ops_passkeys.sign_count may not decrease (% -> %)', old.sign_count, new.sign_count using errcode = 'P0001';
  end if;
  return new;
end $$;

-- public.ops_requests_rate_limit, from 0293_baseline.sql.
CREATE OR REPLACE FUNCTION public.ops_requests_rate_limit() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
begin
  if new.action <> 'restart' then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtext('ops_requests:' || new.target));
  if exists (
    select 1 from ops_requests r
     where r.action = 'restart'
       and r.target = new.target
       and r.state <> 'refused'
       and r.requested_at > new.requested_at - interval '5 minutes'
  ) then
    raise exception 'ops_requests: % was asked to restart less than five minutes ago', new.target
      using errcode = 'P0001', hint = 'one restart per worker per five minutes';
  end if;
  return new;
end $$;

-- public.place_slugs_frozen, from 0293_baseline.sql.
CREATE OR REPLACE FUNCTION public.place_slugs_frozen() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
begin
  if tg_op = 'DELETE' then
    raise exception 'place_slugs: a slug is assigned once and never freed (ags %, %)', old.ags, old.slug;
  end if;
  if new.slug is distinct from old.slug or new.ags is distinct from old.ags then
    raise exception 'place_slugs: a slug is assigned once and never changed (ags %, % → %)', old.ags, old.slug, new.slug;
  end if;
  return new;
end $$;

-- public.station_slugs_frozen, from 0293_baseline.sql.
CREATE OR REPLACE FUNCTION public.station_slugs_frozen() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
begin
  if tg_op = 'DELETE' then
    raise exception 'station_slugs: a slug is assigned once and never freed (%, station %)', old.slug, old.station_no;
  end if;
  if new.slug is distinct from old.slug or new.station_no is distinct from old.station_no then
    raise exception 'station_slugs: a slug is assigned once and never changed (%, station %)', old.slug, old.station_no;
  end if;
  return new;
end $$;

-- public.watches_enforce_session_limit, from 0293_baseline.sql.
CREATE OR REPLACE FUNCTION public.watches_enforce_session_limit() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
declare
  open_count integer;
  limit_per_session constant integer := 10;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.session_id, 0));
  select count(*) into open_count
    from watches
   where session_id = new.session_id and stopped_at is null;
  if open_count >= limit_per_session then
    raise exception
      'session already has % open watches; the limit is % per session — stop one before starting another',
      open_count, limit_per_session
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- public.watch_events_notify, from 0293_baseline.sql.
CREATE OR REPLACE FUNCTION public.watch_events_notify() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
begin
  perform pg_notify(
    'viafrei_watch',
    format('{"v":1,"watch_id":%s,"event_id":%s}', new.watch_id, new.id)
  );
  return null;
end;
$$;

-- public.vf_postcode_normalise, from 0293_baseline.sql.
CREATE OR REPLACE FUNCTION public.vf_postcode_normalise() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
begin
  new.postcode := vf_postcode(new.postcode);
  return new;
end;
$$;

-- public.fuel_stations_set_land, from 0293_baseline.sql.
CREATE OR REPLACE FUNCTION public.fuel_stations_set_land() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
begin
  new.land := fuel_station_land(new.geom);
  new.town_places := fuel_station_town_places(new.geom);
  return new;
end
$$;

-- public.charging_status_runs_note, from 0293_baseline.sql.
CREATE OR REPLACE FUNCTION public.charging_status_runs_note() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
begin
  insert into charging_status_runs as s (observed_at, source_feed, source_run_id, is_delta, stated_at, ticks)
  select n.observed_at, n.source_feed, n.source_run_id, d.is_delta,
         max(least(coalesce(case when d.is_delta then n.last_updated else n.feed_ts end, n.observed_at), n.observed_at)),
         count(*)::int
    from new_ticks n
   cross join lateral (select coalesce(lower(btrim(n.exchange_protocol)) = 'deltapull', false) as is_delta) d
   where coalesce(n.confidentiality, 'noRestriction') = 'noRestriction'
   group by n.observed_at, n.source_feed, n.source_run_id, d.is_delta
  on conflict on constraint charging_status_runs_key do update
     set stated_at = greatest(s.stated_at, excluded.stated_at),
         ticks = s.ticks + excluded.ticks;
  if pg_try_advisory_xact_lock(1289001) then
    delete from charging_status_runs where observed_at < now() - interval '35 days';
  end if;
  return null;
end
$$;

-- public.charging_status_runs_recompute, from 0293_baseline.sql.
CREATE OR REPLACE FUNCTION public.charging_status_runs_recompute() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
begin
  create temp table if not exists charging_status_runs_keys (observed_at timestamptz, source_feed text, source_run_id bigint) on commit drop;
  insert into charging_status_runs_keys select distinct o.observed_at, o.source_feed, o.source_run_id from old_ticks o;
  if tg_op = 'UPDATE' then
    insert into charging_status_runs_keys select distinct n.observed_at, n.source_feed, n.source_run_id from new_ticks n;
  end if;
  delete from charging_status_runs s
   using charging_status_runs_keys k
   where s.observed_at = k.observed_at and s.source_feed = k.source_feed and s.source_run_id is not distinct from k.source_run_id;
  insert into charging_status_runs (observed_at, source_feed, source_run_id, is_delta, stated_at, ticks)
  select t.observed_at, t.source_feed, t.source_run_id, d.is_delta,
         max(least(coalesce(case when d.is_delta then t.last_updated else t.feed_ts end, t.observed_at), t.observed_at)),
         count(*)::int
    from (select distinct * from charging_status_runs_keys) k
    join charging_point_status t
      on t.observed_at = k.observed_at and t.source_feed = k.source_feed and t.source_run_id is not distinct from k.source_run_id
   cross join lateral (select coalesce(lower(btrim(t.exchange_protocol)) = 'deltapull', false) as is_delta) d
   where coalesce(t.confidentiality, 'noRestriction') = 'noRestriction'
   group by t.observed_at, t.source_feed, t.source_run_id, d.is_delta;
  delete from charging_status_runs_keys;
  return null;
end
$$;

-- public.lez_zones_overlaps_trigger, from 0293_baseline.sql.
CREATE OR REPLACE FUNCTION public.lez_zones_overlaps_trigger() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
begin
  if tg_op = 'UPDATE'
     and old.geom is not distinct from new.geom
     and old.role is not distinct from new.role
     and old.closed_at is not distinct from new.closed_at
     and old.source_feed is not distinct from new.source_feed
     and old.zone_id is not distinct from new.zone_id then
    return null;
  end if;
  perform lez_zone_overlaps_refresh(new.source_feed, new.zone_id);
  return null;
end
$$;

-- public.autobahn_sweeps_note, from 0312_contract_mapping.sql.
create or replace function public.autobahn_sweeps_note() returns trigger
  language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
begin
  insert into public.autobahn_sweeps as s (road, kind, observed_at)
  select n.road, n.kind, max(n.observed_at) from new_rows n group by n.road, n.kind
  on conflict (road, kind) do update set observed_at = excluded.observed_at
   where s.observed_at < excluded.observed_at;
  return null;
end $$;

-- public.contract_stop_place_of, from 0316_contract_read_costs.sql.
create or replace function public.contract_stop_place_of(ref text) returns text
  language sql stable strict parallel safe security definer set search_path = pg_catalog, public, pg_temp
  return (select '1:' || s.id from public.stops s
           where s.gtfs_feed_key = 1 and s.deleted_at is null
             and (s.id = substring(ref from '^(?:dhid:)?([a-z]{2}:[0-9]{5}:[0-9]+)')
                  or s.id operator(pg_catalog.~>=~) (substring(ref from '^(?:dhid:)?([a-z]{2}:[0-9]{5}:[0-9]+)') || ':')
                     and s.id operator(pg_catalog.~<~) (substring(ref from '^(?:dhid:)?([a-z]{2}:[0-9]{5}:[0-9]+)') || ';'))
             and (s.location_type = 1 or (s.location_type = 0 and s.parent_id is null))
           order by s.id = substring(ref from '^(?:dhid:)?([a-z]{2}:[0-9]{5}:[0-9]+)') desc, s.id
           limit 1);

-- public.contract_road_shape, from 0312_contract_mapping.sql.
create or replace function public.contract_road_shape(road text, out line geometry(MultiLineString, 4326), out length_km numeric(6,1), out states text[])
language plpgsql stable security definer set search_path = pg_catalog, public, pg_temp
as $$
declare
  lcds integer[];
  links integer[];
  pts geometry[];
  geos geography[];
  named boolean[];
  lat float8[];
  lon float8[];
  nxt integer[] := '{}';
  reached boolean[];
  used boolean[];
  mem integer[] := '{}';  -- the chains' members, end to end
  cs integer[] := '{}';   -- each chain's first offset in mem
  cl integer[] := '{}';   -- each chain's length
  ord integer[];          -- the chains in the road's order
  spur boolean[];
  lines geometry[] := '{}';
  chain geometry[];
  walk integer[];
  ro integer[];           -- the points in the road's order
  main boolean[];
  n integer;
  m integer;
  i integer;
  j integer;
  k integer;
  c integer;
  cur integer;
  pass integer;
  longest integer;
  ax float8;
  ay float8;
  dx float8;
  dy float8;
  best integer;
  best_m float8;
  d float8;
  total float8 := 0;
  land text;
  has_long boolean := false;
begin
  select array_agg(p.lcd order by p.lcd), array_agg(p.pos_off_lcd order by p.lcd), array_agg(p.geom::geometry order by p.lcd),
         array_agg(p.geom order by p.lcd), array_agg(p.tcd = 1 and coalesce(btrim(p.name), '') <> '' order by p.lcd),
         array_agg(st_y(p.geom::geometry) order by p.lcd), array_agg(st_x(p.geom::geometry) order by p.lcd)
    into lcds, links, pts, geos, named, lat, lon
    from public.motorway_points_live p
   where p.road = contract_road_shape.road and p.geom is not null;
  n := coalesce(array_length(lcds, 1), 0);
  if n = 0 then
    return;
  end if;
  reached := array_fill(false, array[n]);
  used := array_fill(false, array[n]);
  for i in 1 .. n loop
    nxt[i] := case when links[i] is not null and links[i] <> lcds[i] then array_position(lcds, links[i]) end;
    if nxt[i] is not null then
      reached[nxt[i]] := true;
    end if;
  end loop;
  for pass in 1 .. 2 loop
    for i in 1 .. n loop
      continue when used[i] or (pass = 1 and reached[i]);
      cs := cs || (coalesce(array_length(mem, 1), 0) + 1);
      cur := i;
      k := 0;
      while cur is not null and not used[cur] loop
        used[cur] := true;
        mem := mem || cur;
        k := k + 1;
        cur := nxt[cur];
      end loop;
      cl := cl || k;
    end loop;
  end loop;
  m := array_length(cs, 1);
  -- the longest chain: the most points, then the smallest first code
  longest := 1;
  for c in 2 .. m loop
    if cl[c] > cl[longest] or (cl[c] = cl[longest] and lcds[mem[cs[c]]] < lcds[mem[cs[longest]]]) then
      longest := c;
    end if;
  end loop;
  ax := lon[mem[cs[longest]]];
  ay := lat[mem[cs[longest]]];
  dx := lon[mem[cs[longest] + cl[longest] - 1]] - ax;
  dy := lat[mem[cs[longest] + cl[longest] - 1]] - ay;
  select array_agg(x.c order by (lon[mem[cs[x.c]]] - ax) * dx + (lat[mem[cs[x.c]]] - ay) * dy, lcds[mem[cs[x.c]]])
    into ord from generate_series(1, m) as x(c);
  -- the spurs, by chain number
  for c in 1 .. m loop
    has_long := has_long or cl[c] > 2;
  end loop;
  spur := array_fill(false, array[m]);
  if has_long then
    for c in 1 .. m loop
      continue when cl[c] > 2;
      <<probe>>
      for i in cs[c] .. cs[c] + cl[c] - 1 loop
        for j in 1 .. m loop
          continue when cl[j] <= 2;
          for k in cs[j] .. cs[j] + cl[j] - 1 loop
            if public.contract_metres(lat[mem[i]], lon[mem[i]], lat[mem[k]], lon[mem[k]]) <= 1000 then
              spur[c] := true;
              exit probe;
            end if;
          end loop;
        end loop;
      end loop;
    end loop;
  end if;
  ord := array(select u.o from unnest(ord) with ordinality u(o, x) where not spur[u.o] order by u.x)
      || array(select u.o from unnest(ord) with ordinality u(o, x) where spur[u.o] order by u.x);
  -- the line and its length
  foreach c in array ord loop
    chain := '{}';
    for i in cs[c] .. cs[c] + cl[c] - 1 loop
      chain := chain || pts[mem[i]];
      if i > cs[c] then
        total := total + public.contract_metres(lat[mem[i - 1]], lon[mem[i - 1]], lat[mem[i]], lon[mem[i]]);
      end if;
    end loop;
    if cl[c] >= 2 then
      lines := lines || st_makeline(chain);
    end if;
  end loop;
  if array_length(lines, 1) is not null then
    line := st_setsrid(st_multi(st_collect(lines)), 4326)::geometry(MultiLineString, 4326);
    length_km := round((total / 1000)::numeric, 1);
  end if;
  -- the road's order: the main chains end to end, each spur after its nearest main point
  ro := '{}';
  foreach c in array ord loop
    continue when spur[c];
    for i in cs[c] .. cs[c] + cl[c] - 1 loop
      ro := ro || mem[i];
    end loop;
  end loop;
  main := array_fill(false, array[n]);
  foreach i in array ro loop
    main[i] := true;
  end loop;
  foreach c in array ord loop
    continue when not spur[c];
    best := 0;
    best_m := 'infinity';
    for k in 1 .. array_length(ro, 1) loop
      continue when not main[ro[k]];
      d := public.contract_metres(lat[mem[cs[c]]], lon[mem[cs[c]]], lat[ro[k]], lon[ro[k]]);
      if d < best_m then
        best_m := d;
        best := k;
      end if;
    end loop;
    walk := '{}';
    for i in cs[c] .. cs[c] + cl[c] - 1 loop
      walk := walk || mem[i];
    end loop;
    ro := ro[1:best] || walk || ro[best + 1:];
  end loop;
  foreach i in array ro loop
    continue when not named[i];
    land := public.contract_junction_land(geos[i]);
    if land is not null and (states is null or not land = any(states)) then
      states := coalesce(states, '{}') || land;
    end if;
  end loop;
end $$;

-- public.contract_junction_land, from 0312_contract_mapping.sql.
create or replace function public.contract_junction_land(p geography) returns text
language sql stable security definer set search_path = pg_catalog, public, pg_temp
as $$
  select left(g.admin_code, 2) from public.gazetteer_places g
   where g.closed_at is null and g.source_id = 'bkg_gvisys' and g.kind = 'city'
     and g.admin_code ~ '^[0-9]{8}$' and g.geom is not null
     and st_dwithin(g.geom, p, 20000)
   order by g.geom <-> p
   limit 1
$$;

-- access.prune_audit, from 0308_access_store.sql.
create or replace function access.prune_audit(before timestamptz) returns bigint
    language plpgsql security definer set search_path = pg_catalog, access, pg_temp as $$
declare
    removed bigint;
begin
    if before > now() - interval '30 days' then
        raise exception 'audit records younger than 30 days are kept';
    end if;
    delete from access.audit where at < before;
    get diagnostics removed = row_count;
    return removed;
end;
$$;

-- access.prune_usage, from 0308_access_store.sql.
create or replace function access.prune_usage(keep_days integer) returns bigint
    language plpgsql security definer set search_path = pg_catalog, access, pg_temp as $$
declare
    removed bigint;
begin
    if keep_days < 30 then
        raise exception 'usage records younger than 30 days are kept';
    end if;
    delete from access.usage where hour < now() - make_interval(days => keep_days);
    get diagnostics removed = row_count;
    return removed;
end;
$$;

-- The trigger functions that set no search_path and no mutant reads.
alter function public.autobahn_events_reset_derived() set search_path = pg_catalog, public, pg_temp;
alter function public.road_events_fill_entry_static() set search_path = pg_catalog, public, pg_temp;

-- SECURITY DEFINER functions whose path lists no pg_temp (searched first): appended.
alter function live.prune_refresh_requests(timestamptz) set search_path = pg_catalog, live, pg_temp;

-- Trigger functions (invoker) whose path lists no pg_temp: appended, one rule for all.
alter function domains.road_events_note_suspended() set search_path = pg_catalog, public, pg_temp;
alter function live.refresh_requests_notify() set search_path = pg_catalog, live, pg_temp;
alter function live.refresh_requests_transition() set search_path = pg_catalog, live, pg_temp;
