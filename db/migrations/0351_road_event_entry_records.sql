-- road_event_entry_records: the clock-free half of "the record of a situation valid at a moment",
-- stored once at write time.
--
-- Every reader of a road event's entry facts picks the record of its situation that is valid at
-- the asked moment, the most restrictive first. The moment changes per read; what each record
-- states does not: its position, its stated validity bounds (as the publisher's text), its lane,
-- hard-shoulder and speed facts, its closed lanes, management types and Alert-C senses. Readers
-- derived all of these again from the payload on every read (a jsonb_array_elements over the
-- situation records and four jsonb_path_query calls per record, after detoasting a payload of up
-- to about a megabyte). On production the motorway plans read spent 46 of 135 ms there for 125
-- plans (0.37 ms a row, EXPLAIN ANALYZE, 2026-11-25).
--
-- ONE TEXT. road_event_entry_records(payload) is the application's per-record select of its
-- record-at-a-moment fragment, generated from it, each record as one object of an array in the
-- publisher's order: n, ps / pe (overallStartTime / overallEndTime as TEXT, the reader casts them
-- as it always did, so the value never depends on the writer's TimeZone), lr (lanes restricted),
-- lt (lanes total), lu (numbered lanes in use, null for none), rw (residual width), hs (hard
-- shoulder), sl (speed limit), cl (closed lanes), mg (management types), se (senses). No record
-- is an empty array, never NULL: NULL means "not written yet", and a reader computes it then.
--
-- WRITE TIME. road_events_fill_entry_static (0330), BEFORE INSERT OR UPDATE OF payload, now fills
-- entry_records beside entry_static, so every row the loader writes or re-pulls after 0351 carries
-- it. The rows written before are filled by road_events_entry_records_backfill(n), as 0330's
-- entry_static: at most n rows a call, oldest id first, skipping a row a writer holds (a partial
-- index on the unfilled ids keeps each call from reading past the filled ones), under the caller's
-- statement and lock timeouts; it returns how many it filled, and the operator calls it until 0
-- (production: about 73 000 rows, 2 000 a call). Until then a reader computes a NULL from the
-- payload, the same value.
--
-- Online: a nullable column with no default changes the catalogue only; the partial index is built
-- over that column while every row is NULL (the table's ids, about 73 000 on production), under
-- lock_timeout.
--
-- rollback:
--   set lock_timeout = '3s';
--   road_events_live, road_events_current: create or replace cannot drop a view column; drop view
--     public.road_events_live cascade (it takes road_events_current) and create both again at their
--     0338 lists, with their grants and comments, in the same transaction, before the column is dropped;
--   road_events_fill_entry_static: create again at its 0330 body (0339 search_path);
--   drop function if exists public.road_events_entry_records_backfill(integer);
--   drop index if exists public.road_events_entry_records_unfilled;
--   drop function if exists public.road_event_entry_records(jsonb);
--   alter table public.road_events drop column if exists entry_records;
--   delete from schema_migrations where version = 351;

set local lock_timeout = '5s';

alter table public.road_events add column if not exists entry_records jsonb;

create or replace function public.road_event_entry_records(p_payload jsonb)
returns jsonb
language sql
immutable parallel safe
set search_path = pg_catalog, public, pg_temp
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
           'n',  r.n,
           'ps', r.rec -> 'validity' -> 0 -> 'validityTimeSpecification' -> 0 -> 'overallStartTime' -> 0 ->> '#text',
           'pe', r.rec -> 'validity' -> 0 -> 'validityTimeSpecification' -> 0 -> 'overallEndTime' -> 0 ->> '#text',
           'lr', r.rec -> 'impact' -> 0 -> 'numberOfLanesRestricted' -> 0 ->> '#text',
           'lt', r.rec -> 'impact' -> 0 -> 'originalNumberOfLanes' -> 0 ->> '#text',
           'lu', nullif((select count(*) from jsonb_path_query(r.rec, '$.impact[0].impactExtension[0].impactExtended[0].laneRestriction[*].lane."#text"') l(v)
                          where l.v #>> '{}' ~ '^lane[0-9]+$'), 0)::int,
           'rw', r.rec -> 'impact' -> 0 -> 'residualRoadWidth' -> 0 ->> '#text',
           'hs', r.rec -> 'impact' -> 0 -> 'impactExtension' -> 0 -> 'impactExtended' -> 0 -> 'hardShoulderStatus' -> 0 ->> '#text',
           'sl', r.rec -> 'operatorActionExtension' -> 0 -> 'operatorActionExtended' -> 0 -> 'mainSpeedLimit' -> 0 ->> '#text',
           'cl', jsonb_path_query_array(r.rec, '$.impact.**.closedLanes."#text"'),
           'mg', jsonb_path_query_array(r.rec, '$.roadOrCarriagewayOrLaneManagementType."#text"'),
           'se', jsonb_path_query_array(r.rec, '$.groupOfLocations.**.alertCDirectionCoded."#text"')
         ) order by r.n), '[]'::jsonb)
    from jsonb_array_elements(case when jsonb_typeof(p_payload -> 'situationRecord') = 'array' then p_payload -> 'situationRecord' else '[]'::jsonb end)
         with ordinality as r(rec, n)
$function$;

-- 0330's trigger function, its 0339 search_path kept, now filling both write-time values.
create or replace function public.road_events_fill_entry_static()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  new.entry_static := public.road_event_entry_static(new.payload);
  new.entry_records := public.road_event_entry_records(new.payload);
  return new;
end
$function$;

create index if not exists road_events_entry_records_unfilled on public.road_events (id) where entry_records is null;

-- Fills entry_records of at most p_batch rows that lack it, oldest id first; returns how many.
create or replace function public.road_events_entry_records_backfill(p_batch integer)
returns integer
language sql
volatile
as $function$
  with b as (
    select id from public.road_events
     where entry_records is null
     order by id
     limit greatest(p_batch, 0)
     for update skip locked
  ), u as (
    update public.road_events e
       set entry_records = public.road_event_entry_records(e.payload)
      from b
     where e.id = b.id
    returning 1
  )
  select count(*)::int from u
$function$;

-- road_events_live is road_events' columns exactly (the snapshot contract), entry_records appended;
-- road_events_current is road_events_live's columns in its order (0335).
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
    land_code,
    entry_records
   from public.road_events
  where deleted_at is null;

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
    land_code,
    entry_records
   from public.road_events_live e
  where closed_at is null
    and public.road_event_in_force_known(overall_start, overall_end, suspended, payload, valid_windows, now())
    and coalesce(confidentiality, 'noRestriction'::text) = 'noRestriction'::text;

comment on column public.road_events.entry_records is 'Each situation record''s clock-free entry facts, in the publisher''s order (road_event_entry_records of payload): n, ps/pe (validity bounds as the publisher''s text), lr, lt, lu, rw, hs, sl, cl, mg, se. Stored by road_events_fill_entry_static at write time and by road_events_entry_records_backfill (0351); a reader picks the record valid at its moment from it. NULL: not written yet, compute it from payload.';
comment on function public.road_events_entry_records_backfill(integer) is 'Fills road_events.entry_records of at most p_batch rows that lack it, oldest id first, skipping locked rows; returns how many (0351). Call it until 0, each call its own transaction under lock_timeout.';
