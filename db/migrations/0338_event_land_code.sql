-- no-transaction: builds road_events_open_land and charging_points_contract_count
-- with create index concurrently,
-- which PostgreSQL refuses inside a transaction block, and fills road_events in
-- chunks, one transaction a chunk (CALL outside a transaction block). Idempotent:
-- every step is if not exists or create or replace, the fill writes only rows
-- whose stored Land differs from the one computed, and an INVALID index of the
-- name (a concurrent build that failed) is dropped and built again.
--
-- land_code: the Land of a road event, stored at write time. The traffic event
-- relation (contract.traffic_event, and the API's statements over the platform's
-- tables that read the same events: the national road summary, the state
-- situations, the state messages) computes, for every live event on every call,
--   contract_junction_land(st_pointonsurface(geom)::geometry(Point,4326)::geography)
-- (geom::geometry on autobahn_events, whose geom is geography): a nearest-
-- neighbour search of the BKG Gemeinden within 20 km, one per event. Production,
-- read only, 2026-11-23: about 15 000 live events a call, the largest cost left
-- in the national road summary (about 1.5 s a call of 1.56 s, docs/perf/sql-plans.md
-- in viafrei-api). Stored, the read is a column.
--
-- ONE EXPRESSION. Each trigger below sets land_code to the relation's own
-- expression over the row's geom, so a stored value is what the relation computes
-- today, for the same gazetteer. Its NULL, as the relation's, means no Gemeinde is
-- near or the row has no geom.
--
-- WRITE TIME. road_events_land and autobahn_events_land, BEFORE INSERT OR UPDATE
-- OF geom, set land_code from the row's geom, so the loaders (which name their
-- columns: the DATEX II upsert rewrites geom on every pull; the Autobahn writer
-- appends) need no release. The row's other columns are not read.
--
-- THE ROWS BEFORE 0338. Production, read only, 2026-11-23:
--   road_events: 64 276 rows (none soft-deleted), 16 002 open, 921 without a
--     geom. This file fills them: CALL public.refresh_event_land(2000), chunks of
--     2 000 rows in id order, each its own transaction under lock_timeout 5s (a
--     chunk takes the row locks of its rows only; the loader's upsert of the same
--     row waits for one chunk at most). About 64 000 lookups: tens of seconds.
--   autobahn_events: 1 767 172 rows (day partitions 2026-11-22: 952 535,
--     2026-11-23: 814 639). A tick table, and ticks are append-only: nothing is
--     written back. The relation reads only the newest sweep of each road and
--     kind, of the last day, so the sweeps written after 0338 carry the column;
--     until then (one sweep, minutes) a reader reads
--     coalesce(land_code, <the expression>), the same value either way.
--
-- THE GAZETTEER. The expression reads gazetteer_places, so a load of it can move
-- a stored Land. public.refresh_event_land(p_batch) recomputes road_events and
-- writes only the rows whose Land changed; the gazetteer load calls it after it
-- commits (outside a transaction block: the procedure commits each chunk).
-- autobahn_events rows are not rewritten (append-only): a sweep after the load
-- carries the new Land, so an event read from a sweep older than the load holds
-- the Land of the gazetteer it was written under, for as long as its sweep stays
-- the newest of its road and kind (at most one day, then the relation drops it).
--
-- road_events_open_land (land_code) where closed_at is null and deleted_at is
-- null: the state situations and the state messages select the open events of
-- one Land. 16 000 rows: under a MB, built in a second.
--
-- charging_points_contract_count (source_feed, site_id) include (evse_id,
-- point_key) where deleted_at is null and site_id is not null and
-- coalesce(confidentiality, 'noRestriction') = 'noRestriction': the national
-- energy summary counts the points of every site of the asked feeds. Production,
-- read only, 2026-11-23: charging_points 329 MB of heap, 433 992 rows, every one
-- in the predicate, the heap all-visible after its autovacuum; without the index
-- the count reads the heap (a sequential scan of 434 000 rows, then a 157 000-
-- group aggregate, about 1.9 s a call). On a test database (440 000 points,
-- 150 000 sites) the API's statement reads it as an Index Only Scan, 0 heap
-- fetches, under the custom and the generic plan. Its keys and the two included
-- columns are narrow text: about 30 MB, one heap pass and a validation scan.
--
-- road_events_live is road_events' columns exactly (the snapshot contract) and
-- road_events_current is road_events_live's, so both append land_code last:
-- create or replace keeps their grants, their comments and their rows.
--
-- Online: the columns are nullable with no default, so each add column changes
-- the catalogue only and rewrites nothing; lock_timeout makes it give up on a
-- writer's lock rather than queue every reader behind it (migrate retries 55P03).
--
-- rollback:
--   set lock_timeout = '5s';
--   drop index concurrently if exists public.road_events_open_land;
--   drop index concurrently if exists public.charging_points_contract_count;
--   drop trigger if exists road_events_land on public.road_events;
--   drop trigger if exists autobahn_events_land on public.autobahn_events;
--   drop procedure if exists public.refresh_event_land(integer);
--   drop function if exists public.road_events_fill_land();
--   drop function if exists public.autobahn_events_fill_land();
--   road_events_live, road_events_current: create or replace cannot drop a view
--     column; drop view public.road_events_live cascade (it takes
--     road_events_current) and create both again at their 0335 lists, with their
--     grants and comments, in the same transaction, before the column is dropped;
--   alter table public.road_events drop column if exists land_code;
--   alter table public.autobahn_events drop column if exists land_code;
--   delete from schema_migrations where version = 338;

begin;
set local lock_timeout = '5s';

alter table public.road_events add column if not exists land_code text;
alter table public.autobahn_events add column if not exists land_code text;

-- The traffic event relation's DATEX II branch: st_pointonsurface(e.geom), a geometry.
create or replace function public.road_events_fill_land()
returns trigger
language plpgsql
as $function$
begin
  new.land_code := public.contract_junction_land(st_pointonsurface(new.geom)::geometry(Point,4326)::geography);
  return new;
end
$function$;

drop trigger if exists road_events_land on public.road_events;
create trigger road_events_land before insert or update of geom on public.road_events
  for each row execute function public.road_events_fill_land();

-- The relation's Autobahn branch: st_pointonsurface(a.geom::geometry), geom being geography.
create or replace function public.autobahn_events_fill_land()
returns trigger
language plpgsql
as $function$
begin
  new.land_code := public.contract_junction_land(st_pointonsurface(new.geom::geometry)::geometry(Point,4326)::geography);
  return new;
end
$function$;

drop trigger if exists autobahn_events_land on public.autobahn_events;
create trigger autobahn_events_land before insert or update of geom on public.autobahn_events
  for each row execute function public.autobahn_events_fill_land();

-- Recomputes road_events.land_code, p_batch rows a chunk in id order, one
-- transaction a chunk; writes only a row whose stored Land differs. CALL it
-- outside a transaction block (it commits). The update names land_code alone, so
-- no trigger of geom or payload fires.
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
    perform set_config('lock_timeout', '5s', true);
    with b as (
      select e.id from public.road_events e
       where e.id > after_id
       order by e.id
       limit p_batch
    ), u as (
      update public.road_events e
         set land_code = x.land
        from (select b.id, public.contract_junction_land(st_pointonsurface(r.geom)::geometry(Point,4326)::geography) as land
                from b join public.road_events r on r.id = b.id) x
       where e.id = x.id and e.land_code is distinct from x.land
    )
    select max(b.id) into last_id from b;
    exit when last_id is null;
    after_id := last_id;
    commit;
  end loop;
end
$procedure$;

create or replace view public.road_events_live as
 select id,
    feed_key,
    source_id,
    publication_id,
    version,
    publisher,
    event_type,
    road_number,
    referent_from,
    referent_to,
    distance_from_m,
    distance_to_m,
    geom,
    feed_ts,
    overall_start,
    overall_end,
    payload,
    first_seen_at,
    last_seen_at,
    closed_at,
    source_feed,
    source_publisher,
    source_run_id,
    provider_updated_at,
    created_at,
    updated_at,
    deleted_at,
    deleted_reason,
    deleted_run_id,
    confidentiality,
    closure_starts_at,
    closure_ends_at,
    valid_windows,
    suspended,
    entry_static,
    land_code
   from public.road_events
  where (deleted_at is null);

create or replace view public.road_events_current as
 select id,
    feed_key,
    source_id,
    publication_id,
    version,
    publisher,
    event_type,
    road_number,
    referent_from,
    referent_to,
    distance_from_m,
    distance_to_m,
    geom,
    feed_ts,
    overall_start,
    overall_end,
    payload,
    first_seen_at,
    last_seen_at,
    closed_at,
    source_feed,
    source_publisher,
    source_run_id,
    provider_updated_at,
    created_at,
    updated_at,
    deleted_at,
    deleted_reason,
    deleted_run_id,
    confidentiality,
    closure_starts_at,
    closure_ends_at,
    valid_windows,
    suspended,
    entry_static,
    land_code
   from public.road_events_live e
  where e.closed_at is null
    and public.road_event_in_force_known(e.overall_start, e.overall_end, e.suspended, e.payload, e.valid_windows, now())
    and coalesce(e.confidentiality, 'noRestriction') = 'noRestriction';

comment on column public.road_events.land_code is 'The Land (two AGS digits) of the event: contract_junction_land(st_pointonsurface(geom)::geometry(Point,4326)::geography), the traffic event relation''s expression, stored by road_events_land at write time and by refresh_event_land after a gazetteer load (0338); NULL when no Gemeinde is within 20 km or the row has no geom.';
comment on column public.autobahn_events.land_code is 'The Land (two AGS digits) of the event: contract_junction_land(st_pointonsurface(geom::geometry)::geometry(Point,4326)::geography), the traffic event relation''s expression, stored by autobahn_events_land at write time (0338); never rewritten (ticks are append-only). NULL also on a row written before 0338: read coalesce(land_code, the expression).';
comment on procedure public.refresh_event_land(integer) is 'Recomputes road_events.land_code in chunks of p_batch rows, one transaction a chunk, writing only rows whose Land changed (0338); CALL it outside a transaction block, after a gazetteer load.';

commit;

-- The rows written before 0338 (and none twice: a filled row is not written).
call public.refresh_event_land(2000);

set max_parallel_maintenance_workers = 0;
set maintenance_work_mem = '64MB';
set lock_timeout = '5s';
select 'drop index concurrently ' || x.indexrelid::regclass::text
  from pg_index x
 where x.indexrelid in (to_regclass('public.road_events_open_land'), to_regclass('public.charging_points_contract_count')) and not x.indisvalid
\gexec
create index concurrently if not exists road_events_open_land on public.road_events (land_code)
  where closed_at is null and deleted_at is null;
create index concurrently if not exists charging_points_contract_count on public.charging_points (source_feed, site_id) include (evse_id, point_key)
  where deleted_at is null and site_id is not null and coalesce(confidentiality, 'noRestriction') = 'noRestriction';
reset lock_timeout;

do $$
declare
  bad text;
begin
  select string_agg(n, ', ') into bad
    from unnest(array['public.road_events_open_land', 'public.charging_points_contract_count']) n
   where not exists (select from pg_index x where x.indexrelid = to_regclass(n) and x.indisvalid);
  if bad is not null then
    raise exception '% missing or INVALID after its build', bad;
  end if;
end
$$;
