-- The parking domains, in the domain shape of domains.speed_cameras (the
-- system columns, the owner key, the match, owner-open and gist indexes,
-- row-level security with the own-insert policy, and for the state tables the
-- own-update policy and the trust-ranked _merged view, and the same grants).
--
-- The licence boundaries of the old tables are kept as tables of their own,
-- because a share-alike or gated row must never be read or exported with the
-- others:
--   domains.parking_facilities       / domains.parking_occupancy        (public.parking_facilities / parking_occupancy)
--   domains.parking_facilities_bysa                                     (public.parking_facilities_bysa; no occupancy is published)
--   domains.parking_facilities_odbl  / domains.parking_occupancy_odbl   (public.parking_facilities_odbl / parking_occupancy_odbl)
--   domains.parking_facilities_sid   / domains.parking_occupancy_sid    (public.parking_facilities_sid / parking_occupancy_sid)
--   domains.street_bays              / domains.street_bay_state         (public.street_bays / street_bay_state)
-- The licence a row is under is its source's (ingestor.sources.licence_id),
-- and a source is registered for exactly one of these domains, which the
-- own-insert policy enforces; the old attribution_id checks become that.
--
-- The gated pair (_sid) gets the same grants as the others: the ingestor
-- writes it, no reader is granted it. The old public.parking_*_sid tables are
-- granted to no reader either, only their narrow _live views are, behind the
-- terms of use the application asks for; a reader of the domain tables is to
-- be granted the same way, through a view, and never the table.
--
-- An occupancy row's external_id is the external_id of its facility in the
-- facility table of the same pair; a street bay state's is the external_id of
-- its bay. A writer whose occupancy or state feed is another source than the
-- facility's sets match_key to the facility's.
--
-- Ticks: parking_occupancy and parking_occupancy_sid are append-only and
-- partitioned by day on observed_at, no default partition, each with its row
-- in public.partition_retention (14 days, then the cold store, as their old
-- twins). parking_occupancy_odbl is append-only and NOT partitioned, as its
-- old twin: the share-alike offer exports its full history, and the partition
-- retention job would drop its days. Kept forever.
--
-- Arrays the old tables held as text[] (facilities, facilities_absent,
-- implausible_fields) are JSON arrays here, the type a writer can write, with
-- the old vocabularies; domains.jsonb_texts lets the disjointness check read
-- them.
--
-- Not carried, because no reader uses them: source_version, facilities_extra,
-- station_ref, station_name, station_name_norm, raw, last_message_at, the
-- street bay's bay_id (its key is source_id, feed and external_id now) and the
-- state's last_seen_at. Dropped as bookkeeping the domain shape replaces:
-- source_feed (source_id and feed), first_seen_at and updated_at (system
-- columns), source_run_id on state tables, created_at, deleted_at,
-- deleted_reason and deleted_run_id (a row its publisher withdraws is closed).
-- public.street_bay_ticks has no reader and gets no domain twin.
--
-- The merged views' (w).* and r.* were expanded when they were created: a
-- later migration that adds a column to one of these tables must drop and
-- recreate its _merged view.
--
-- Nothing reads these tables yet and no reader is granted them. The old
-- tables and their data are not touched.
--
-- rollback: delete from public.partition_retention where schema_name = 'domains'
--   and table_name in ('parking_occupancy', 'parking_occupancy_sid');
--   drop view domains.street_bay_state_merged, domains.street_bays_merged,
--   domains.parking_facilities_sid_merged, domains.parking_facilities_odbl_merged,
--   domains.parking_facilities_bysa_merged, domains.parking_facilities_merged;
--   drop table domains.street_bay_state, domains.street_bays,
--   domains.parking_occupancy_sid, domains.parking_occupancy_odbl,
--   domains.parking_occupancy, domains.parking_facilities_sid,
--   domains.parking_facilities_odbl, domains.parking_facilities_bysa,
--   domains.parking_facilities;
--   drop function domains.jsonb_texts(jsonb);
--   delete from schema_migrations where version = 299;

create function domains.jsonb_texts(a jsonb) returns text[]
  language sql immutable strict parallel safe
  set search_path = pg_catalog
as $$ select coalesce(array_agg(x), '{}') from jsonb_array_elements_text(case when jsonb_typeof(a) = 'array' then a else '[]'::jsonb end) x $$;

comment on function domains.jsonb_texts(jsonb) is 'The strings of a JSON array as a text array; an empty array for anything else. Used by the parking facility checks.';

create table domains.parking_facilities (
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
  name text,
  operator text,
  road text,
  capacity_total integer,
  capacity_truck integer,
  capacity_disabled integer,
  address jsonb,
  opening jsonb,
  confidentiality text,
  facilities jsonb not null default '[]'::jsonb,
  facilities_absent jsonb not null default '[]'::jsonb,
  facilities_source text,
  source_publisher text,
  provider_updated_at timestamptz,
  last_seen_at timestamptz,
  primary key (id),
  constraint parking_facilities_owner_key unique (source_id, feed, external_id),
  constraint parking_facilities_geom_point check (geom is null or GeometryType(geom) = 'POINT'),
  constraint parking_facilities_kind check (kind in ('rest_area', 'car_park', 'park_and_ride', 'truck', 'other')),
  constraint parking_facilities_capacity check (coalesce(capacity_total, 0) >= 0 and coalesce(capacity_truck, 0) >= 0 and coalesce(capacity_disabled, 0) >= 0),
  constraint parking_facilities_address_object check (address is null or jsonb_typeof(address) = 'object'),
  constraint parking_facilities_facilities_vocabulary check (jsonb_typeof(facilities) = 'array' and facilities <@ jsonb_build_array('toilet', 'accessible_toilet', 'shower', 'restaurant', 'snack', 'cafe', 'shop', 'fuel', 'charging', 'drinking_water', 'picnic', 'playground', 'wifi', 'security')),
  constraint parking_facilities_facilities_absent_vocabulary check (jsonb_typeof(facilities_absent) = 'array' and facilities_absent <@ jsonb_build_array('toilet', 'accessible_toilet', 'shower', 'restaurant', 'snack', 'cafe', 'shop', 'fuel', 'charging', 'drinking_water', 'picnic', 'playground', 'wifi', 'security')),
  constraint parking_facilities_facilities_disjoint check (not (facilities ?| domains.jsonb_texts(facilities_absent))),
  constraint parking_facilities_facilities_source check ((facilities_source is null) = (facilities = '[]'::jsonb and facilities_absent = '[]'::jsonb)),
  constraint parking_facilities_facilities_source_nonempty check (facilities_source is null or facilities_source <> '')
);

comment on table domains.parking_facilities is 'Parking facilities, one row per facility and source: motorway rest areas, truck parking, car parks, park-and-ride. Share-alike and gated publishers have tables of their own.';

create index parking_facilities_match on domains.parking_facilities (match_key) where closed_at is null;
create index parking_facilities_owner_open on domains.parking_facilities (source_id, feed) where closed_at is null;
create index parking_facilities_geom on domains.parking_facilities using gist (geom);

alter table domains.parking_facilities enable row level security;
alter table domains.parking_facilities force row level security;
create policy parking_facilities_read on domains.parking_facilities for select using (true);
create policy parking_facilities_own_insert on domains.parking_facilities for insert to viafrei_ingestor
  with check (source_id = current_setting('viafrei.source_id', true)
              and exists (select 1 from ingestor.sources s where s.id = source_id and s.domain = 'parking_facilities'));
create policy parking_facilities_own_update on domains.parking_facilities for update to viafrei_ingestor
  using (source_id = current_setting('viafrei.source_id', true))
  with check (source_id = current_setting('viafrei.source_id', true));
grant select, insert, update on domains.parking_facilities to viafrei_ingestor;

create view domains.parking_facilities_merged as
with live as (
  select r.*, coalesce(r.match_key, r.source_id || '|' || r.feed || '|' || r.external_id) as entity_key,
         s.trust, s.attribution, s.licence_id
    from domains.parking_facilities r left join ingestor.sources s on s.id = r.source_id
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
grant select on domains.parking_facilities_merged to viafrei_ingestor;

create table domains.parking_facilities_bysa (
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
  name text,
  operator text,
  road text,
  capacity_total integer,
  capacity_truck integer,
  capacity_disabled integer,
  address jsonb,
  opening jsonb,
  confidentiality text,
  source_publisher text,
  provider_updated_at timestamptz,
  last_seen_at timestamptz,
  primary key (id),
  constraint parking_facilities_bysa_owner_key unique (source_id, feed, external_id),
  constraint parking_facilities_bysa_geom_point check (geom is null or GeometryType(geom) = 'POINT'),
  constraint parking_facilities_bysa_kind check (kind in ('rest_area', 'car_park', 'park_and_ride', 'truck', 'other')),
  constraint parking_facilities_bysa_capacity check (coalesce(capacity_total, 0) >= 0 and coalesce(capacity_truck, 0) >= 0 and coalesce(capacity_disabled, 0) >= 0),
  constraint parking_facilities_bysa_address_object check (address is null or jsonb_typeof(address) = 'object')
);

comment on table domains.parking_facilities_bysa is 'Parking facilities published under CC BY-SA, one row per facility and source: Adapted Material of its own, never mixed with domains.parking_facilities.';

create index parking_facilities_bysa_match on domains.parking_facilities_bysa (match_key) where closed_at is null;
create index parking_facilities_bysa_owner_open on domains.parking_facilities_bysa (source_id, feed) where closed_at is null;
create index parking_facilities_bysa_geom on domains.parking_facilities_bysa using gist (geom);

alter table domains.parking_facilities_bysa enable row level security;
alter table domains.parking_facilities_bysa force row level security;
create policy parking_facilities_bysa_read on domains.parking_facilities_bysa for select using (true);
create policy parking_facilities_bysa_own_insert on domains.parking_facilities_bysa for insert to viafrei_ingestor
  with check (source_id = current_setting('viafrei.source_id', true)
              and exists (select 1 from ingestor.sources s where s.id = source_id and s.domain = 'parking_facilities_bysa'));
create policy parking_facilities_bysa_own_update on domains.parking_facilities_bysa for update to viafrei_ingestor
  using (source_id = current_setting('viafrei.source_id', true))
  with check (source_id = current_setting('viafrei.source_id', true));
grant select, insert, update on domains.parking_facilities_bysa to viafrei_ingestor;

create view domains.parking_facilities_bysa_merged as
with live as (
  select r.*, coalesce(r.match_key, r.source_id || '|' || r.feed || '|' || r.external_id) as entity_key,
         s.trust, s.attribution, s.licence_id
    from domains.parking_facilities_bysa r left join ingestor.sources s on s.id = r.source_id
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
grant select on domains.parking_facilities_bysa_merged to viafrei_ingestor;

create table domains.parking_facilities_odbl (
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
  name text,
  operator text,
  road text,
  capacity_total integer,
  capacity_truck integer,
  capacity_disabled integer,
  address jsonb,
  opening jsonb,
  confidentiality text,
  source_publisher text,
  provider_updated_at timestamptz,
  last_seen_at timestamptz,
  primary key (id),
  constraint parking_facilities_odbl_owner_key unique (source_id, feed, external_id),
  constraint parking_facilities_odbl_geom_point check (geom is null or GeometryType(geom) = 'POINT'),
  constraint parking_facilities_odbl_kind check (kind in ('rest_area', 'car_park', 'park_and_ride', 'truck', 'other')),
  constraint parking_facilities_odbl_capacity check (coalesce(capacity_total, 0) >= 0 and coalesce(capacity_truck, 0) >= 0 and coalesce(capacity_disabled, 0) >= 0),
  constraint parking_facilities_odbl_address_object check (address is null or jsonb_typeof(address) = 'object')
);

comment on table domains.parking_facilities_odbl is 'Parking facilities published under ODbL, one row per facility and source: a share-alike database of its own with domains.parking_occupancy_odbl, never mixed with domains.parking_facilities.';

create index parking_facilities_odbl_match on domains.parking_facilities_odbl (match_key) where closed_at is null;
create index parking_facilities_odbl_owner_open on domains.parking_facilities_odbl (source_id, feed) where closed_at is null;
create index parking_facilities_odbl_geom on domains.parking_facilities_odbl using gist (geom);

alter table domains.parking_facilities_odbl enable row level security;
alter table domains.parking_facilities_odbl force row level security;
create policy parking_facilities_odbl_read on domains.parking_facilities_odbl for select using (true);
create policy parking_facilities_odbl_own_insert on domains.parking_facilities_odbl for insert to viafrei_ingestor
  with check (source_id = current_setting('viafrei.source_id', true)
              and exists (select 1 from ingestor.sources s where s.id = source_id and s.domain = 'parking_facilities_odbl'));
create policy parking_facilities_odbl_own_update on domains.parking_facilities_odbl for update to viafrei_ingestor
  using (source_id = current_setting('viafrei.source_id', true))
  with check (source_id = current_setting('viafrei.source_id', true));
grant select, insert, update on domains.parking_facilities_odbl to viafrei_ingestor;

create view domains.parking_facilities_odbl_merged as
with live as (
  select r.*, coalesce(r.match_key, r.source_id || '|' || r.feed || '|' || r.external_id) as entity_key,
         s.trust, s.attribution, s.licence_id
    from domains.parking_facilities_odbl r left join ingestor.sources s on s.id = r.source_id
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
grant select on domains.parking_facilities_odbl_merged to viafrei_ingestor;

create table domains.parking_facilities_sid (
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
  name text,
  capacity_total integer,
  capacity_truck integer,
  address jsonb,
  confidentiality text,
  facilities jsonb not null default '[]'::jsonb,
  facilities_absent jsonb not null default '[]'::jsonb,
  facilities_source text,
  source_publisher text,
  provider_updated_at timestamptz,
  last_seen_at timestamptz,
  primary key (id),
  constraint parking_facilities_sid_owner_key unique (source_id, feed, external_id),
  constraint parking_facilities_sid_geom_point check (geom is null or GeometryType(geom) = 'POINT'),
  constraint parking_facilities_sid_kind check (kind in ('rest_area', 'car_park', 'park_and_ride', 'truck', 'other')),
  constraint parking_facilities_sid_capacity check (coalesce(capacity_total, 0) >= 0 and coalesce(capacity_truck, 0) >= 0),
  constraint parking_facilities_sid_address_object check (address is null or jsonb_typeof(address) = 'object'),
  constraint parking_facilities_sid_facilities_vocabulary check (jsonb_typeof(facilities) = 'array' and facilities <@ jsonb_build_array('toilet', 'accessible_toilet', 'shower', 'restaurant', 'snack', 'cafe', 'shop', 'fuel', 'charging', 'drinking_water', 'picnic', 'playground', 'wifi', 'security')),
  constraint parking_facilities_sid_facilities_absent_vocabulary check (jsonb_typeof(facilities_absent) = 'array' and facilities_absent <@ jsonb_build_array('toilet', 'accessible_toilet', 'shower', 'restaurant', 'snack', 'cafe', 'shop', 'fuel', 'charging', 'drinking_water', 'picnic', 'playground', 'wifi', 'security')),
  constraint parking_facilities_sid_facilities_disjoint check (not (facilities ?| domains.jsonb_texts(facilities_absent))),
  constraint parking_facilities_sid_facilities_source check ((facilities_source is null) = (facilities = '[]'::jsonb and facilities_absent = '[]'::jsonb)),
  constraint parking_facilities_sid_facilities_source_nonempty check (facilities_source is null or facilities_source <> '')
);

comment on table domains.parking_facilities_sid is 'Truck parking facilities behind the terms-of-use gate, one row per facility and source; kept apart so that no grant on domains.parking_facilities reaches them.';

create index parking_facilities_sid_match on domains.parking_facilities_sid (match_key) where closed_at is null;
create index parking_facilities_sid_owner_open on domains.parking_facilities_sid (source_id, feed) where closed_at is null;
create index parking_facilities_sid_geom on domains.parking_facilities_sid using gist (geom);

alter table domains.parking_facilities_sid enable row level security;
alter table domains.parking_facilities_sid force row level security;
create policy parking_facilities_sid_read on domains.parking_facilities_sid for select using (true);
create policy parking_facilities_sid_own_insert on domains.parking_facilities_sid for insert to viafrei_ingestor
  with check (source_id = current_setting('viafrei.source_id', true)
              and exists (select 1 from ingestor.sources s where s.id = source_id and s.domain = 'parking_facilities_sid'));
create policy parking_facilities_sid_own_update on domains.parking_facilities_sid for update to viafrei_ingestor
  using (source_id = current_setting('viafrei.source_id', true))
  with check (source_id = current_setting('viafrei.source_id', true));
grant select, insert, update on domains.parking_facilities_sid to viafrei_ingestor;

create view domains.parking_facilities_sid_merged as
with live as (
  select r.*, coalesce(r.match_key, r.source_id || '|' || r.feed || '|' || r.external_id) as entity_key,
         s.trust, s.attribution, s.licence_id
    from domains.parking_facilities_sid r left join ingestor.sources s on s.id = r.source_id
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
grant select on domains.parking_facilities_sid_merged to viafrei_ingestor;

create table domains.parking_occupancy (
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
  spaces_free integer,
  spaces_total integer,
  occupancy_pct numeric(5,2),
  status text,
  feed_ts timestamptz,
  confidentiality text,
  implausible_fields jsonb,
  source_run_id bigint,
  primary key (id, observed_at),
  constraint parking_occupancy_owner_key unique (source_id, feed, external_id, observed_at),
  constraint parking_occupancy_geom_point check (geom is null or GeometryType(geom) = 'POINT'),
  constraint parking_occupancy_counts check (coalesce(spaces_free, 0) >= 0 and coalesce(spaces_total, 0) >= 0),
  constraint parking_occupancy_pct check (occupancy_pct is null or occupancy_pct >= 0),
  constraint parking_occupancy_implausible check (implausible_fields is null or (jsonb_typeof(implausible_fields) = 'array' and jsonb_array_length(implausible_fields) > 0 and implausible_fields <@ jsonb_build_array('occupancy_pct', 'spaces_free', 'spaces_total', 'feed_ts')))
) partition by range (observed_at);

comment on table domains.parking_occupancy is 'Observed free and occupied counts at a facility of domains.parking_facilities, one row per facility and observation. Append-only, day-partitioned.';

create index parking_occupancy_match on domains.parking_occupancy (match_key) where closed_at is null;
create index parking_occupancy_owner_open on domains.parking_occupancy (source_id, feed) where closed_at is null;
create index parking_occupancy_geom on domains.parking_occupancy using gist (geom);
create index parking_occupancy_brin on domains.parking_occupancy using brin (observed_at);
create index parking_occupancy_facility on domains.parking_occupancy (external_id, observed_at desc);

alter table domains.parking_occupancy enable row level security;
alter table domains.parking_occupancy force row level security;
create policy parking_occupancy_read on domains.parking_occupancy for select using (true);
create policy parking_occupancy_own_insert on domains.parking_occupancy for insert to viafrei_ingestor
  with check (source_id = current_setting('viafrei.source_id', true)
              and exists (select 1 from ingestor.sources s where s.id = source_id and s.domain = 'parking_occupancy'));
grant select, insert on domains.parking_occupancy to viafrei_ingestor;

insert into public.partition_retention (schema_name, table_name, keep_days, archive, reason)
values ('domains', 'parking_occupancy', 14, true, 'as its old twin public.parking_occupancy: 14 days, then the cold store, because an occupancy feed offers each observation once');

create table domains.parking_occupancy_odbl (
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
  spaces_free integer,
  spaces_total integer,
  occupancy_pct numeric(5,2),
  status text,
  feed_ts timestamptz,
  confidentiality text,
  implausible_fields jsonb,
  source_run_id bigint,
  primary key (id, observed_at),
  constraint parking_occupancy_odbl_owner_key unique (source_id, feed, external_id, observed_at),
  constraint parking_occupancy_odbl_geom_point check (geom is null or GeometryType(geom) = 'POINT'),
  constraint parking_occupancy_odbl_counts check (coalesce(spaces_free, 0) >= 0 and coalesce(spaces_total, 0) >= 0),
  constraint parking_occupancy_odbl_pct check (occupancy_pct is null or occupancy_pct >= 0),
  constraint parking_occupancy_odbl_implausible check (implausible_fields is null or (jsonb_typeof(implausible_fields) = 'array' and jsonb_array_length(implausible_fields) > 0 and implausible_fields <@ jsonb_build_array('occupancy_pct', 'spaces_free', 'spaces_total', 'feed_ts')))
);

comment on table domains.parking_occupancy_odbl is 'Observed counts at a facility of domains.parking_facilities_odbl, one row per facility and observation. Append-only and not partitioned, as its old twin: the share-alike offer exports its full history, so no day is ever dropped.';

create index parking_occupancy_odbl_match on domains.parking_occupancy_odbl (match_key) where closed_at is null;
create index parking_occupancy_odbl_owner_open on domains.parking_occupancy_odbl (source_id, feed) where closed_at is null;
create index parking_occupancy_odbl_geom on domains.parking_occupancy_odbl using gist (geom);
create index parking_occupancy_odbl_brin on domains.parking_occupancy_odbl using brin (observed_at);
create index parking_occupancy_odbl_facility on domains.parking_occupancy_odbl (external_id, observed_at desc);

alter table domains.parking_occupancy_odbl enable row level security;
alter table domains.parking_occupancy_odbl force row level security;
create policy parking_occupancy_odbl_read on domains.parking_occupancy_odbl for select using (true);
create policy parking_occupancy_odbl_own_insert on domains.parking_occupancy_odbl for insert to viafrei_ingestor
  with check (source_id = current_setting('viafrei.source_id', true)
              and exists (select 1 from ingestor.sources s where s.id = source_id and s.domain = 'parking_occupancy_odbl'));
grant select, insert on domains.parking_occupancy_odbl to viafrei_ingestor;

create table domains.parking_occupancy_sid (
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
  spaces_free integer,
  spaces_total integer,
  occupancy_pct numeric(5,2),
  status text,
  feed_ts timestamptz,
  confidentiality text,
  implausible_fields jsonb,
  source_run_id bigint,
  primary key (id, observed_at),
  constraint parking_occupancy_sid_owner_key unique (source_id, feed, external_id, observed_at),
  constraint parking_occupancy_sid_geom_point check (geom is null or GeometryType(geom) = 'POINT'),
  constraint parking_occupancy_sid_counts check (coalesce(spaces_free, 0) >= 0 and coalesce(spaces_total, 0) >= 0),
  constraint parking_occupancy_sid_pct check (occupancy_pct is null or occupancy_pct >= 0),
  constraint parking_occupancy_sid_implausible check (implausible_fields is null or (jsonb_typeof(implausible_fields) = 'array' and jsonb_array_length(implausible_fields) > 0 and implausible_fields <@ jsonb_build_array('occupancy_pct', 'spaces_free', 'spaces_total', 'feed_ts')))
) partition by range (observed_at);

comment on table domains.parking_occupancy_sid is 'Observed counts at a facility of domains.parking_facilities_sid, behind the terms-of-use gate, one row per facility and observation. Append-only, day-partitioned.';

create index parking_occupancy_sid_match on domains.parking_occupancy_sid (match_key) where closed_at is null;
create index parking_occupancy_sid_owner_open on domains.parking_occupancy_sid (source_id, feed) where closed_at is null;
create index parking_occupancy_sid_geom on domains.parking_occupancy_sid using gist (geom);
create index parking_occupancy_sid_brin on domains.parking_occupancy_sid using brin (observed_at);
create index parking_occupancy_sid_facility on domains.parking_occupancy_sid (external_id, observed_at desc);

alter table domains.parking_occupancy_sid enable row level security;
alter table domains.parking_occupancy_sid force row level security;
create policy parking_occupancy_sid_read on domains.parking_occupancy_sid for select using (true);
create policy parking_occupancy_sid_own_insert on domains.parking_occupancy_sid for insert to viafrei_ingestor
  with check (source_id = current_setting('viafrei.source_id', true)
              and exists (select 1 from ingestor.sources s where s.id = source_id and s.domain = 'parking_occupancy_sid'));
grant select, insert on domains.parking_occupancy_sid to viafrei_ingestor;

insert into public.partition_retention (schema_name, table_name, keep_days, archive, reason)
values ('domains', 'parking_occupancy_sid', 14, true, 'as its old twin public.parking_occupancy_sid: 14 days, then the cold store');

create table domains.street_bays (
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
  publisher_kind text,
  street text,
  house_number text,
  postcode text,
  city text,
  charge_point_operator text,
  spaces integer,
  reserved_when text,
  source_publisher text,
  provider_updated_at timestamptz,
  primary key (id),
  constraint street_bays_owner_key unique (source_id, feed, external_id),
  constraint street_bays_geom_point check (geom is null or GeometryType(geom) = 'POINT'),
  constraint street_bays_kind check (kind in ('disabled', 'ev_charging', 'loading', 'regular', 'unspecified')),
  constraint street_bays_postcode check (postcode is null or postcode ~ '^[0-9]{5}$'),
  constraint street_bays_spaces check (spaces is null or (spaces >= 1 and spaces <= 99))
);

comment on table domains.street_bays is 'On-street parking bays, one row per bay and source: disabled, charging, loading and regular bays with where they are.';

create index street_bays_match on domains.street_bays (match_key) where closed_at is null;
create index street_bays_owner_open on domains.street_bays (source_id, feed) where closed_at is null;
create index street_bays_geom on domains.street_bays using gist (geom);

alter table domains.street_bays enable row level security;
alter table domains.street_bays force row level security;
create policy street_bays_read on domains.street_bays for select using (true);
create policy street_bays_own_insert on domains.street_bays for insert to viafrei_ingestor
  with check (source_id = current_setting('viafrei.source_id', true)
              and exists (select 1 from ingestor.sources s where s.id = source_id and s.domain = 'street_bays'));
create policy street_bays_own_update on domains.street_bays for update to viafrei_ingestor
  using (source_id = current_setting('viafrei.source_id', true))
  with check (source_id = current_setting('viafrei.source_id', true));
grant select, insert, update on domains.street_bays to viafrei_ingestor;

create view domains.street_bays_merged as
with live as (
  select r.*, coalesce(r.match_key, r.source_id || '|' || r.feed || '|' || r.external_id) as entity_key,
         s.trust, s.attribution, s.licence_id
    from domains.street_bays r left join ingestor.sources s on s.id = r.source_id
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
grant select on domains.street_bays_merged to viafrei_ingestor;

create table domains.street_bay_state (
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
  state text not null,
  message_at timestamptz not null,
  source_publisher text,
  provider_updated_at timestamptz,
  primary key (id),
  constraint street_bay_state_owner_key unique (source_id, feed, external_id),
  constraint street_bay_state_geom_point check (geom is null or GeometryType(geom) = 'POINT'),
  constraint street_bay_state_known check (state in ('free', 'occupied'))
);

comment on table domains.street_bay_state is 'The current state of an on-street bay of domains.street_bays, one row per bay and source: free or occupied, and when the sensor said so.';

create index street_bay_state_match on domains.street_bay_state (match_key) where closed_at is null;
create index street_bay_state_owner_open on domains.street_bay_state (source_id, feed) where closed_at is null;
create index street_bay_state_geom on domains.street_bay_state using gist (geom);

alter table domains.street_bay_state enable row level security;
alter table domains.street_bay_state force row level security;
create policy street_bay_state_read on domains.street_bay_state for select using (true);
create policy street_bay_state_own_insert on domains.street_bay_state for insert to viafrei_ingestor
  with check (source_id = current_setting('viafrei.source_id', true)
              and exists (select 1 from ingestor.sources s where s.id = source_id and s.domain = 'street_bay_state'));
create policy street_bay_state_own_update on domains.street_bay_state for update to viafrei_ingestor
  using (source_id = current_setting('viafrei.source_id', true))
  with check (source_id = current_setting('viafrei.source_id', true));
grant select, insert, update on domains.street_bay_state to viafrei_ingestor;

create view domains.street_bay_state_merged as
with live as (
  select r.*, coalesce(r.match_key, r.source_id || '|' || r.feed || '|' || r.external_id) as entity_key,
         s.trust, s.attribution, s.licence_id
    from domains.street_bay_state r left join ingestor.sources s on s.id = r.source_id
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
grant select on domains.street_bay_state_merged to viafrei_ingestor;
