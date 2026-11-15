-- domains.road_events: DATEX II situations and traffic messages (roadworks,
-- closures, accidents, obstructions), one row per publication and source, in
-- the domain shape of domains.speed_cameras (the system columns, the owner key,
-- the match, owner-open and gist indexes, row-level security with the
-- own-insert and own-update policies for viafrei_ingestor, the read policy,
-- the trust-ranked _merged view and the same grants).
--
-- The old public.road_events keys a row on (source_id, publication_id), where
-- its source_id is the publication's creator: a publication id is unique only
-- within its creator. Here source_id is the ingestor source, the creator is
-- publication_creator, and external_id is <publication_creator>:<publication_id>,
-- held equal to the two columns by a check, so two creators in one feed cannot
-- collide on one id.
--
-- The old child table public.road_event_locations becomes the locations array
-- (one object per stretch, in published order); the situation record types of
-- the publication become record_types. valid_windows is a JSON array of
-- {"start", "end"} objects (ISO 8601 instants, either may be null) instead of a
-- tstzmultirange, which the writer cannot write. suspended is derived from the
-- payload by the database, as for the old table, so a writer cannot disagree
-- with its own payload.
--
-- No tick twin: public.road_event_ticks has no reader, keeps one day and is not
-- archived, so nothing here replaces it.
--
-- The merged view's (w).* and r.* were expanded when it was created: a later
-- migration that adds a column to the table must drop and recreate
-- road_events_merged, or the view goes on without that column.
--
-- Nothing reads this table yet and no reader is granted it. The old tables and
-- their data are not touched.
--
-- rollback: drop view domains.road_events_merged; drop table domains.road_events;
--   delete from schema_migrations where version = 297;

create table domains.road_events (
  id bigint generated always as identity,
  source_id text not null check (source_id ~ '^[a-z][a-z0-9_-]{2,62}$'),
  feed text not null default 'default',
  external_id text not null check (external_id <> ''),
  match_key text,
  observed_at timestamptz not null default clock_timestamp(),
  first_seen_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  closed_at timestamptz,
  geom geometry(Geometry, 4326),
  extras jsonb not null default '{}'::jsonb,
  publication_creator text not null,
  publication_id text not null,
  version integer not null,
  publisher text,
  event_type text,
  road_number text,
  referent_from text,
  referent_to text,
  distance_from_m integer,
  distance_to_m integer,
  feed_ts timestamptz,
  overall_start timestamptz,
  overall_end timestamptz,
  closure_starts_at timestamptz,
  closure_ends_at timestamptz,
  valid_windows jsonb,
  suspended boolean,
  confidentiality text,
  payload jsonb not null,
  locations jsonb not null default '[]'::jsonb,
  record_types jsonb not null default '[]'::jsonb,
  source_publisher text,
  provider_updated_at timestamptz,
  primary key (id),
  constraint road_events_owner_key unique (source_id, feed, external_id),
  constraint road_events_external_id_shape check (external_id = publication_creator || ':' || publication_id),
  constraint road_events_publication_creator check (publication_creator <> ''),
  constraint road_events_publication_id check (publication_id <> ''),
  constraint road_events_payload_object check (jsonb_typeof(payload) = 'object'),
  constraint road_events_valid_windows_array check (valid_windows is null or jsonb_typeof(valid_windows) = 'array'),
  constraint road_events_locations_array check (jsonb_typeof(locations) = 'array'),
  constraint road_events_record_types_array check (jsonb_typeof(record_types) = 'array')
);

comment on table domains.road_events is 'DATEX II situations and traffic messages, one row per publication and source: where on which road, when it is in force, and the publication as received.';
comment on column domains.road_events.external_id is 'The publication''s key within its source: <publication_creator>:<publication_id>.';
comment on column domains.road_events.publication_creator is 'The DATEX II publication creator (the old table''s source_id): a publication id is unique only within its creator.';
comment on column domains.road_events.publication_id is 'The publisher''s id of the situation or message.';
comment on column domains.road_events.version is 'The publication''s version, as published.';
comment on column domains.road_events.feed_ts is 'The feed''s own publication time, verbatim.';
comment on column domains.road_events.valid_windows is 'A JSON array of {"start", "end"} objects, ISO 8601 instants, the windows in which the publication is in force; null when it states none.';
comment on column domains.road_events.suspended is 'True when a validity of the payload is suspended; set by the database from payload.';
comment on column domains.road_events.confidentiality is 'The DATEX II confidentiality as published; a row is shown only when it is null or noRestriction.';
comment on column domains.road_events.locations is 'A JSON array of the stretches, in published order: {"seq", "road_number", "referent_from", "referent_to", "distance_from_m", "distance_to_m", "lon", "lat"}.';
comment on column domains.road_events.record_types is 'A JSON array of the situation record types the publication carries.';
comment on column domains.road_events.provider_updated_at is 'When the publisher says the publication last changed, verbatim.';

create function domains.road_events_note_suspended() returns trigger
  language plpgsql
  set search_path = pg_catalog, public
as $$
begin
  new.suspended := public.road_event_suspended(new.payload);
  return new;
end
$$;

create trigger road_events_suspended before insert or update on domains.road_events
  for each row execute function domains.road_events_note_suspended();

create index road_events_match on domains.road_events (match_key) where closed_at is null;
create index road_events_owner_open on domains.road_events (source_id, feed) where closed_at is null;
create index road_events_geom on domains.road_events using gist (geom);
create index road_events_open on domains.road_events (road_number, overall_start desc) where closed_at is null;
create index road_events_ref_key on domains.road_events (public.road_ref_key(road_number)) where road_number is not null and closed_at is null;

-- Own rows only, enforced by the database: a writer may insert or update a row
-- only when its source_id is the transaction's viafrei.source_id AND that
-- source is registered for this domain. No setting, no write.
alter table domains.road_events enable row level security;
alter table domains.road_events force row level security;
create policy road_events_read on domains.road_events for select using (true);
create policy road_events_own_insert on domains.road_events for insert to viafrei_ingestor
  with check (source_id = current_setting('viafrei.source_id', true)
              and exists (select 1 from ingestor.sources s where s.id = source_id and s.domain = 'road_events'));
create policy road_events_own_update on domains.road_events for update to viafrei_ingestor
  using (source_id = current_setting('viafrei.source_id', true))
  with check (source_id = current_setting('viafrei.source_id', true));
grant select, insert, update on domains.road_events to viafrei_ingestor;

-- One merged entity per match key, the winner by source trust and then the
-- freshest, every contributing source attributed.
create view domains.road_events_merged as
with live as (
  select r.*, coalesce(r.match_key, r.source_id || '|' || r.feed || '|' || r.external_id) as entity_key,
         s.trust, s.attribution, s.licence_id
    from domains.road_events r left join ingestor.sources s on s.id = r.source_id
   where r.closed_at is null
), ranked as (
  select l as w,
         row_number() over (partition by l.entity_key order by l.trust desc nulls last, l.observed_at desc, l.source_id, l.external_id) as rn,
         jsonb_agg(jsonb_build_object('source_id', l.source_id, 'feed', l.feed, 'external_id', l.external_id,
                                      'attribution', l.attribution, 'licence_id', l.licence_id, 'observed_at', l.observed_at))
           over entity as sources,
         count(*) over entity as source_count
    from live l
  window entity as (partition by l.entity_key order by l.source_id, l.feed, l.external_id
                    rows between unbounded preceding and unbounded following)
)
select (k.w).*, k.sources, k.source_count::int as source_count
  from ranked k where k.rn = 1;
grant select on domains.road_events_merged to viafrei_ingestor;
