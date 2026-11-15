-- The road context layers and the traffic cameras, in the domain shape of
-- domains.speed_cameras (the system columns, the owner key, the match,
-- owner-open and gist indexes, row-level security with the own-insert policy,
-- and for the state tables the own-update policy and the trust-ranked _merged
-- view, and the same grants):
--   domains.road_context_features          (public.road_context_features)
--   domains.road_context_feature_versions  (public.road_context_feature_versions)
--   domains.webcams                        (public.hh_cameras, and the motorway
--                                           operator's cameras, which no old
--                                           table holds)
--
-- road_context_features: external_id is the old feature_id. kind and variant
-- keep the old closed vocabulary, one check each. props stays the open bag a
-- publisher's facts live in (a period's valid_from and valid_to, a coach
-- count, a bus-request flag); readers read it as before. anchor is generated
-- from geom by the old loader's rule. answerable has no default: null is read
-- as the old default, true. geom is nullable as in every domain: a row without
-- one is never near anything, so it never answers.
--
-- road_context_feature_versions: the old version history, append-only. One row
-- per feature and change of its content_hash, with the props and geometry of
-- that version. Not partitioned and no retention row, as its old twin, which
-- keeps every version. Its owner key includes observed_at: a feature whose
-- content returns to an earlier state is a new row, where the old table kept
-- one row per hash. A writer appends a version only when the hash differs from
-- the state row's, stamped with that run's observed_at.
--
-- webcams: external_id is the old camera_id. No image or image URL is stored;
-- link_url, optional and https only, is the publisher's page for the camera.
--
-- Not carried, because no reader uses them, or because the domain shape
-- replaces them: source_feed (the feed is the domain's feed), source_run_id on
-- the state tables, created_at, the old first_seen_at and updated_at (the
-- system columns), and the old checks that pinned one feed per table: the
-- source is ingestor.sources' now.
--
-- The merged views' (w).* and r.* were expanded when they were created: a
-- later migration that adds a column to one of these tables must drop and
-- recreate its _merged view.
--
-- Nothing reads these tables yet and no reader is granted them. The old
-- tables and their data are not touched.
--
-- rollback: drop view domains.webcams_merged, domains.road_context_features_merged;
--   drop table domains.webcams, domains.road_context_feature_versions,
--   domains.road_context_features;
--   delete from schema_migrations where version = 301;

create table domains.road_context_features (
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
  kind text not null,
  variant text not null,
  name text not null,
  ref text,
  detail_text text,
  answerable boolean,
  props jsonb not null default '{}'::jsonb,
  content_hash text not null,
  source_publisher text,
  provider_updated_at timestamptz,
  last_seen_at timestamptz,
  anchor geometry(Point, 4326) generated always as (ST_ClosestPoint(geom, ST_Centroid(geom))) stored,
  primary key (id),
  constraint road_context_features_owner_key unique (source_id, feed, external_id),
  constraint road_context_features_kind check (kind in ('border_crossing', 'traffic_signal', 'winter_service', 'pedestrian_zone_access', 'detour', 'loading_zone', 'coach_parking', 'motorway_detour', 'street_parking', 'signal_installation')),
  constraint road_context_features_variant check (
         (kind = 'border_crossing' and variant in ('motorway', 'federal', 'state', 'district', 'ferry', 'other'))
      or (kind = 'traffic_signal' and variant in ('acoustic', 'plain'))
      or (kind = 'winter_service' and variant in ('priority_1', 'priority_2', 'priority_3', 'unranked'))
      or (kind = 'pedestrian_zone_access' and variant in ('pedestrian_zone', 'no_motor_vehicles', 'no_entry', 'no_cycling', 'sign_not_listed'))
      or (kind = 'detour' and variant in ('motor_vehicles', 'lorries', 'cars', 'cycles', 'all_traffic', 'other'))
      or (kind = 'loading_zone' and variant in ('load_deliver', 'load_deliver_work', 'alternating', 'other'))
      or (kind = 'coach_parking' and variant in ('parking', 'stop_only'))
      or (kind = 'motorway_detour' and variant in ('signed'))
      or (kind = 'street_parking' and variant in ('ticket', 'disc', 'unmanaged', 'disabled', 'ev_charging', 'loading', 'sharing', 'disabled_personal', 'restricted_stopping', 'no_stopping', 'unresolved', 'other'))
      or (kind = 'signal_installation' and variant in ('junction', 'pedestrian_crossing', 'other'))),
  constraint road_context_features_props_object check (jsonb_typeof(props) = 'object'),
  constraint road_context_features_content_hash check (content_hash <> '')
);

comment on table domains.road_context_features is 'City and road-authority traffic layers, one row per feature and source: border crossings, signals, winter service, pedestrian-zone entrances, detours, loading zones, coach parking, signed motorway detours, street parking and signal installations. Kind and variant are a closed vocabulary; the rest of what a publisher states is in props.';

create index road_context_features_match on domains.road_context_features (match_key) where closed_at is null;
create index road_context_features_owner_open on domains.road_context_features (source_id, feed) where closed_at is null;
create index road_context_features_geom on domains.road_context_features using gist (geom);
create index road_context_features_kind_open on domains.road_context_features (kind) where closed_at is null;
comment on column domains.road_context_features.anchor is 'The point of geom nearest its centroid, generated: the point a feature is drawn from.';

alter table domains.road_context_features enable row level security;
alter table domains.road_context_features force row level security;
create policy road_context_features_read on domains.road_context_features for select using (true);
create policy road_context_features_own_insert on domains.road_context_features for insert to viafrei_ingestor
  with check (source_id = current_setting('viafrei.source_id', true)
              and exists (select 1 from ingestor.sources s where s.id = source_id and s.domain = 'road_context_features'));
create policy road_context_features_own_update on domains.road_context_features for update to viafrei_ingestor
  using (source_id = current_setting('viafrei.source_id', true))
  with check (source_id = current_setting('viafrei.source_id', true));
grant select, insert, update on domains.road_context_features to viafrei_ingestor;

create view domains.road_context_features_merged as
with live as (
  select r.*, coalesce(r.match_key, r.source_id || '|' || r.feed || '|' || r.external_id) as entity_key,
         s.trust, s.attribution, s.licence_id
    from domains.road_context_features r left join ingestor.sources s on s.id = r.source_id
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
grant select on domains.road_context_features_merged to viafrei_ingestor;

create table domains.road_context_feature_versions (
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
  content_hash text not null,
  props jsonb not null default '{}'::jsonb,
  source_run_id bigint,
  primary key (id, observed_at),
  constraint road_context_feature_versions_owner_key unique (source_id, feed, external_id, observed_at),
  constraint road_context_feature_versions_props_object check (jsonb_typeof(props) = 'object'),
  constraint road_context_feature_versions_content_hash check (content_hash <> '')
);

comment on table domains.road_context_feature_versions is 'The version history of domains.road_context_features: one row per feature, source and change of its content, with the props and geometry it had then. Append-only and not partitioned, as its old twin: a change is rare and every version is kept.';

create index road_context_feature_versions_match on domains.road_context_feature_versions (match_key) where closed_at is null;
create index road_context_feature_versions_owner_open on domains.road_context_feature_versions (source_id, feed) where closed_at is null;
create index road_context_feature_versions_geom on domains.road_context_feature_versions using gist (geom);
create index road_context_feature_versions_brin on domains.road_context_feature_versions using brin (observed_at);

alter table domains.road_context_feature_versions enable row level security;
alter table domains.road_context_feature_versions force row level security;
create policy road_context_feature_versions_read on domains.road_context_feature_versions for select using (true);
create policy road_context_feature_versions_own_insert on domains.road_context_feature_versions for insert to viafrei_ingestor
  with check (source_id = current_setting('viafrei.source_id', true)
              and exists (select 1 from ingestor.sources s where s.id = source_id and s.domain = 'road_context_feature_versions'));
grant select, insert on domains.road_context_feature_versions to viafrei_ingestor;

create table domains.webcams (
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
  location_label text not null,
  note text,
  road_number text,
  direction text,
  link_url text,
  source_publisher text,
  provider_updated_at timestamptz,
  last_seen_at timestamptz,
  primary key (id),
  constraint webcams_owner_key unique (source_id, feed, external_id),
  constraint webcams_geom_point check (geom is null or GeometryType(geom) = 'POINT'),
  constraint webcams_location_label check (location_label <> ''),
  constraint webcams_link_url check (link_url is null or link_url ~ '^https://')
);

comment on table domains.webcams is 'Traffic cameras, one row per camera and source: where it is and what it shows. No image is stored; link_url is the publisher''s page for the camera.';

create index webcams_match on domains.webcams (match_key) where closed_at is null;
create index webcams_owner_open on domains.webcams (source_id, feed) where closed_at is null;
create index webcams_geom on domains.webcams using gist (geom);

alter table domains.webcams enable row level security;
alter table domains.webcams force row level security;
create policy webcams_read on domains.webcams for select using (true);
create policy webcams_own_insert on domains.webcams for insert to viafrei_ingestor
  with check (source_id = current_setting('viafrei.source_id', true)
              and exists (select 1 from ingestor.sources s where s.id = source_id and s.domain = 'webcams'));
create policy webcams_own_update on domains.webcams for update to viafrei_ingestor
  using (source_id = current_setting('viafrei.source_id', true))
  with check (source_id = current_setting('viafrei.source_id', true));
grant select, insert, update on domains.webcams to viafrei_ingestor;

create view domains.webcams_merged as
with live as (
  select r.*, coalesce(r.match_key, r.source_id || '|' || r.feed || '|' || r.external_id) as entity_key,
         s.trust, s.attribution, s.licence_id
    from domains.webcams r left join ingestor.sources s on s.id = r.source_id
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
grant select on domains.webcams_merged to viafrei_ingestor;
