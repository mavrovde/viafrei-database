-- The weather domains, in the domain shape of domains.speed_cameras (the
-- system columns, the owner key, the match, owner-open and gist indexes,
-- row-level security with the own-insert policy, and for the state tables the
-- own-update policy and the trust-ranked _merged view, and the same grants):
--   domains.weather_warnings       (public.weather_warnings)
--   domains.weather_warnings_en    (public.weather_warnings_en)
--   domains.road_weather_stations  (public.road_weather_stations)
--   domains.road_weather_forecast  (public.road_weather_forecast)
--
-- The English feed is a second domain, not columns on the German row and not
-- a child table: it is a feed of its own, with its own alerts, versions and
-- identifiers, written by its own source, and a source may update only its own
-- rows. The German row stays the authority for level, window and cell; the
-- two are joined by content as public.weather_warning_english joins the old
-- tables: the English sent_at equals the German published_at, valid_from and
-- valid_to are equal, the German warncell_id is one of the English
-- warncell_ids, and the English event_ii equals the German event_code_ii (the
-- EC_II event code the old join read out of the German raw payload).
-- weather_warnings_area_live, weather_warning_english and the digest role read
-- the old tables and keep working unchanged.
--
-- weather_warnings: external_id is <identifier>:<warncell_id>:<version>, held
-- equal to the three columns; a changed warning is a new row and the old
-- version is closed. geom is the warn cell's area. Kept forever, as the old
-- table: a warning is a public record. weather_warnings_en: external_id is
-- <identifier>:<content_sha256>, held equal; no geometry.
--
-- road_weather_forecast is a series: append-only, day-partitioned on
-- observed_at, no default partition. Its old twin holds the latest run only
-- and is replaced whole by each run, so its row in public.partition_retention
-- keeps one day, the shortest window the retention job allows, with no
-- archive: every run is in the raw archive. A reader takes the newest run of
-- a station. A writer stamps one observed_at, or one source_run_id, per run.
--
-- Not carried, because no reader uses them: raw (the one key a reader took
-- from it is event_code_ii / event_ii), and the old
-- constant checks that pinned one publisher (source_id = 'dwd_road',
-- position_source = 'swsKatalog'): the source is ingestor.sources' now.
-- Dropped as bookkeeping the domain shape replaces: id, source_feed,
-- source_id (the old attribution key; the licence is the source's),
-- first_seen_at, updated_at, created_at, source_run_id on state tables,
-- deleted_at, deleted_reason, deleted_run_id. smallint and real become integer
-- and double precision, the types a writer declares. closed_reason is
-- optional: a source's ordinary close sets closed_at alone.
--
-- The merged views' (w).* and r.* were expanded when they were created: a
-- later migration that adds a column to one of these tables must drop and
-- recreate its _merged view.
--
-- Nothing reads these tables yet and no reader is granted them. The old
-- tables and their data are not touched.
--
-- rollback: delete from public.partition_retention where schema_name = 'domains'
--   and table_name = 'road_weather_forecast';
--   drop view domains.road_weather_stations_merged, domains.weather_warnings_en_merged,
--   domains.weather_warnings_merged;
--   drop table domains.road_weather_forecast, domains.road_weather_stations,
--   domains.weather_warnings_en, domains.weather_warnings;
--   delete from schema_migrations where version = 300;

create table domains.weather_warnings (
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
  identifier text not null,
  warncell_id text not null,
  version integer not null,
  area_desc text,
  event text,
  event_code_ii text,
  level integer not null,
  level_source text,
  severity text,
  urgency text,
  certainty text,
  headline text,
  description text,
  instruction text,
  official_sha256 text not null,
  valid_from timestamptz not null,
  valid_to timestamptz,
  published_at timestamptz,
  area_sha256 text not null,
  closed_reason text,
  source_publisher text,
  provider_updated_at timestamptz,
  last_seen_at timestamptz,
  primary key (id),
  constraint weather_warnings_owner_key unique (source_id, feed, external_id),
  constraint weather_warnings_external_id_shape check (external_id = identifier || ':' || warncell_id || ':' || version),
  constraint weather_warnings_geom_area check (geom is null or GeometryType(geom) = 'MULTIPOLYGON'),
  constraint weather_warnings_level check (level between 0 and 4),
  constraint weather_warnings_level_source check (level_source is null or level_source in ('published', 'derived_from_severity')),
  constraint weather_warnings_hash check (official_sha256 ~ '^[0-9a-f]{64}$'),
  constraint weather_warnings_area_hash check (area_sha256 ~ '^[0-9a-f]{64}$'),
  constraint weather_warnings_window check (valid_to is null or valid_to >= valid_from),
  constraint weather_warnings_closed_reason check (closed_reason is null or (closed_at is not null and closed_reason in ('withdrawn', 'superseded')))
);

comment on table domains.weather_warnings is 'Official DWD weather warnings, one row per version of a warning per warn cell and source: the wording byte for byte with its SHA-256, the level, the window and the area. A changed warning is a new version and the old one is closed as superseded.';

create index weather_warnings_match on domains.weather_warnings (match_key) where closed_at is null;
create index weather_warnings_owner_open on domains.weather_warnings (source_id, feed) where closed_at is null;
create index weather_warnings_geom on domains.weather_warnings using gist (geom);
create index weather_warnings_live_cell on domains.weather_warnings (warncell_id, level desc, valid_to) where closed_at is null;

alter table domains.weather_warnings enable row level security;
alter table domains.weather_warnings force row level security;
create policy weather_warnings_read on domains.weather_warnings for select using (true);
create policy weather_warnings_own_insert on domains.weather_warnings for insert to viafrei_ingestor
  with check (source_id = current_setting('viafrei.source_id', true)
              and exists (select 1 from ingestor.sources s where s.id = source_id and s.domain = 'weather_warnings'));
create policy weather_warnings_own_update on domains.weather_warnings for update to viafrei_ingestor
  using (source_id = current_setting('viafrei.source_id', true))
  with check (source_id = current_setting('viafrei.source_id', true));
grant select, insert, update on domains.weather_warnings to viafrei_ingestor;

create view domains.weather_warnings_merged as
with live as (
  select r.*, coalesce(r.match_key, r.source_id || '|' || r.feed || '|' || r.external_id) as entity_key,
         s.trust, s.attribution, s.licence_id
    from domains.weather_warnings r left join ingestor.sources s on s.id = r.source_id
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
grant select on domains.weather_warnings_merged to viafrei_ingestor;

create table domains.weather_warnings_en (
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
  identifier text not null,
  base_identifier text not null,
  msg_type text,
  language text not null,
  event text,
  event_code integer,
  event_ii text,
  headline text,
  description text,
  instruction text,
  content_sha256 text not null,
  sent_at timestamptz,
  valid_from timestamptz,
  valid_to timestamptz,
  warncell_ids jsonb not null default '[]'::jsonb,
  closed_reason text,
  source_publisher text,
  provider_updated_at timestamptz,
  primary key (id),
  constraint weather_warnings_en_owner_key unique (source_id, feed, external_id),
  constraint weather_warnings_en_external_id_shape check (external_id = identifier || ':' || content_sha256),
  constraint weather_warnings_en_geom_none check (geom is null),
  constraint weather_warnings_en_hash check (content_sha256 ~ '^[0-9a-f]{64}$'),
  constraint weather_warnings_en_language check (language <> ''),
  constraint weather_warnings_en_warncell_ids_array check (jsonb_typeof(warncell_ids) = 'array'),
  constraint weather_warnings_en_window check (valid_to is null or valid_from is null or valid_to >= valid_from),
  constraint weather_warnings_en_closed_reason check (closed_reason is null or (closed_at is not null and closed_reason in ('withdrawn', 'superseded')))
);

comment on table domains.weather_warnings_en is 'The DWD''s own English text of a warning, one row per alert of the English snapshot and version of its text, per source. Text only: the German row of domains.weather_warnings stays the authority for level, window and cell, and the two are joined by content.';

create index weather_warnings_en_match on domains.weather_warnings_en (match_key) where closed_at is null;
create index weather_warnings_en_owner_open on domains.weather_warnings_en (source_id, feed) where closed_at is null;
create index weather_warnings_en_geom on domains.weather_warnings_en using gist (geom);
create index weather_warnings_en_live_sent on domains.weather_warnings_en (sent_at, valid_from) where closed_at is null;

alter table domains.weather_warnings_en enable row level security;
alter table domains.weather_warnings_en force row level security;
create policy weather_warnings_en_read on domains.weather_warnings_en for select using (true);
create policy weather_warnings_en_own_insert on domains.weather_warnings_en for insert to viafrei_ingestor
  with check (source_id = current_setting('viafrei.source_id', true)
              and exists (select 1 from ingestor.sources s where s.id = source_id and s.domain = 'weather_warnings_en'));
create policy weather_warnings_en_own_update on domains.weather_warnings_en for update to viafrei_ingestor
  using (source_id = current_setting('viafrei.source_id', true))
  with check (source_id = current_setting('viafrei.source_id', true));
grant select, insert, update on domains.weather_warnings_en to viafrei_ingestor;

create view domains.weather_warnings_en_merged as
with live as (
  select r.*, coalesce(r.match_key, r.source_id || '|' || r.feed || '|' || r.external_id) as entity_key,
         s.trust, s.attribution, s.licence_id
    from domains.weather_warnings_en r left join ingestor.sources s on s.id = r.source_id
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
grant select on domains.weather_warnings_en_merged to viafrei_ingestor;

create table domains.road_weather_stations (
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
  name text not null,
  segment_type integer,
  surface integer,
  position_source text,
  height_m integer,
  flag_raw text,
  inactive boolean,
  inactive_raw text,
  source_publisher text,
  provider_updated_at timestamptz,
  last_seen_at timestamptz,
  primary key (id),
  constraint road_weather_stations_owner_key unique (source_id, feed, external_id),
  constraint road_weather_stations_geom_point check (geom is null or GeometryType(geom) = 'POINT'),
  constraint road_weather_stations_segment check (segment_type is null or segment_type in (1, 2)),
  constraint road_weather_stations_surface check (surface is null or surface in (1, 2))
);

comment on table domains.road_weather_stations is 'Road-weather stations, one row per station and source: name, open road or bridge, position and whether the station is inactive.';

create index road_weather_stations_match on domains.road_weather_stations (match_key) where closed_at is null;
create index road_weather_stations_owner_open on domains.road_weather_stations (source_id, feed) where closed_at is null;
create index road_weather_stations_geom on domains.road_weather_stations using gist (geom);

alter table domains.road_weather_stations enable row level security;
alter table domains.road_weather_stations force row level security;
create policy road_weather_stations_read on domains.road_weather_stations for select using (true);
create policy road_weather_stations_own_insert on domains.road_weather_stations for insert to viafrei_ingestor
  with check (source_id = current_setting('viafrei.source_id', true)
              and exists (select 1 from ingestor.sources s where s.id = source_id and s.domain = 'road_weather_stations'));
create policy road_weather_stations_own_update on domains.road_weather_stations for update to viafrei_ingestor
  using (source_id = current_setting('viafrei.source_id', true))
  with check (source_id = current_setting('viafrei.source_id', true));
grant select, insert, update on domains.road_weather_stations to viafrei_ingestor;

create view domains.road_weather_stations_merged as
with live as (
  select r.*, coalesce(r.match_key, r.source_id || '|' || r.feed || '|' || r.external_id) as entity_key,
         s.trust, s.attribution, s.licence_id
    from domains.road_weather_stations r left join ingestor.sources s on s.id = r.source_id
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
grant select on domains.road_weather_stations_merged to viafrei_ingestor;

create table domains.road_weather_forecast (
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
  station_id text not null,
  valid_at timestamptz not null,
  run_at timestamptz not null,
  tl double precision,
  tlsta double precision,
  rrl1c double precision,
  rrs1c double precision,
  rr6 double precision,
  wwl6 double precision,
  wws3 double precision,
  rrs3c double precision,
  r650 double precision,
  rc integer,
  ts double precision,
  td double precision,
  source_run_id bigint,
  primary key (id, observed_at),
  constraint road_weather_forecast_owner_key unique (source_id, feed, external_id, observed_at),
  constraint road_weather_forecast_geom_none check (geom is null),
  constraint road_weather_forecast_rc check (rc is null or rc between 1 and 6)
) partition by range (observed_at);

comment on table domains.road_weather_forecast is 'Road-weather model forecasts, one row per station, valid hour and run, per source: road condition class and temperatures. Append-only, day-partitioned; the newest run of a station is its forecast.';

create index road_weather_forecast_match on domains.road_weather_forecast (match_key) where closed_at is null;
create index road_weather_forecast_owner_open on domains.road_weather_forecast (source_id, feed) where closed_at is null;
create index road_weather_forecast_geom on domains.road_weather_forecast using gist (geom);
create index road_weather_forecast_brin on domains.road_weather_forecast using brin (observed_at);
create index road_weather_forecast_station on domains.road_weather_forecast (station_id, observed_at desc, valid_at);

alter table domains.road_weather_forecast enable row level security;
alter table domains.road_weather_forecast force row level security;
create policy road_weather_forecast_read on domains.road_weather_forecast for select using (true);
create policy road_weather_forecast_own_insert on domains.road_weather_forecast for insert to viafrei_ingestor
  with check (source_id = current_setting('viafrei.source_id', true)
              and exists (select 1 from ingestor.sources s where s.id = source_id and s.domain = 'road_weather_forecast'));
grant select, insert on domains.road_weather_forecast to viafrei_ingestor;

insert into public.partition_retention (schema_name, table_name, keep_days, archive, reason)
values ('domains', 'road_weather_forecast', 1, false, 'as its old twin public.road_weather_forecast, which holds the latest run only: the shortest window the retention job keeps, and no archive, because the raw archive holds every run');
