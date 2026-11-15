-- domains.charging_points: static charge points for electric vehicles, one row
-- per point and source, in the domain shape of domains.speed_cameras (the
-- system columns, the owner key, the match, owner-open and gist indexes,
-- row-level security with the own-insert and own-update policies for
-- viafrei_ingestor, the read policy, the trust-ranked _merged view and the
-- same grants). No live status and no price: the point status stays in
-- public.charging_point_status.
--
-- external_id is <device_id>:<point_no>, the key of the old
-- public.charging_points.point_key; site_key is the old
-- public.charging_sites.site_id of the same publisher.
--
-- The shape is the national register's, its one writer so far; the other
-- static point publishers come with a migration of their own, which adds their
-- columns (prices, the publisher's point id, the DATEX II marking) and relaxes
-- the not-null columns they do not have.
--
-- The merged view's (w).* and r.* were expanded when it was created: a later
-- migration that adds a column to the table must drop and recreate
-- charging_points_merged, or the view goes on without that column.
--
-- Nothing reads this table yet and no reader is granted it. The old tables and
-- their data are not touched.
--
-- rollback: drop view domains.charging_points_merged; drop table domains.charging_points;
--   delete from schema_migrations where version = 295;

create table domains.charging_points (
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
  device_id text not null,
  point_no integer not null,
  site_key text not null,
  operator text,
  site_name text,
  street text,
  house_number text,
  postcode text,
  city text,
  status text,
  device_kind text,
  connector_types jsonb,
  plugs jsonb,
  current_type text,
  max_power_kw double precision,
  evse_id text,
  evse_id_published text,
  commissioned_on date,
  published_on date,
  primary key (id),
  constraint charging_points_owner_key unique (source_id, feed, external_id),
  constraint charging_points_point_no check (point_no >= 1),
  constraint charging_points_geom_point check (geom is null or GeometryType(geom) = 'POINT'),
  constraint charging_points_connector_types_array check (connector_types is null or jsonb_typeof(connector_types) = 'array'),
  constraint charging_points_plugs_array check (plugs is null or jsonb_typeof(plugs) = 'array'),
  constraint charging_points_max_power_kw check (max_power_kw is null or max_power_kw >= 0),
  constraint charging_points_current_type check (current_type is null or current_type in ('ac', 'dc', 'both'))
);

comment on table domains.charging_points is 'Static charge points for electric vehicles, one row per point and source: where it is, who operates it, its plugs and its rated power. No live status and no price.';
comment on column domains.charging_points.external_id is 'The point''s key within its source: <device_id>:<point_no>.';
comment on column domains.charging_points.device_id is 'The publisher''s id of the charging device the point belongs to.';
comment on column domains.charging_points.point_no is 'The point''s position on its device, from 1.';
comment on column domains.charging_points.site_key is 'One operator at one coordinate: <lat>,<lon>:<12 hex>.';
comment on column domains.charging_points.operator is 'The operator shown: an organisation''s name; null when the operator is not recognisably an organisation.';
comment on column domains.charging_points.status is 'The point''s state as published, never a live availability.';
comment on column domains.charging_points.connector_types is 'A JSON array of AFIR / DATEX II connectorType values; a word with no such value is kept as published.';
comment on column domains.charging_points.plugs is 'A JSON array of the plug words as published.';
comment on column domains.charging_points.current_type is 'ac, dc or both; null when nothing says.';
comment on column domains.charging_points.max_power_kw is 'The point''s largest rated power, kW.';
comment on column domains.charging_points.evse_id is 'The point''s EVSE id when the publisher gives exactly one valid id.';
comment on column domains.charging_points.evse_id_published is 'The EVSE id as published, when it is not one valid id: kept, and never a join key.';
comment on column domains.charging_points.published_on is 'The release date the publisher''s file states.';

create index charging_points_match on domains.charging_points (match_key) where closed_at is null;
create index charging_points_owner_open on domains.charging_points (source_id, feed) where closed_at is null;
create index charging_points_geom on domains.charging_points using gist (geom);

-- Own rows only, enforced by the database: a writer may insert or update a row
-- only when its source_id is the transaction's viafrei.source_id AND that
-- source is registered for this domain. No setting, no write.
alter table domains.charging_points enable row level security;
alter table domains.charging_points force row level security;
create policy charging_points_read on domains.charging_points for select using (true);
create policy charging_points_own_insert on domains.charging_points for insert to viafrei_ingestor
  with check (source_id = current_setting('viafrei.source_id', true)
              and exists (select 1 from ingestor.sources s where s.id = source_id and s.domain = 'charging_points'));
create policy charging_points_own_update on domains.charging_points for update to viafrei_ingestor
  using (source_id = current_setting('viafrei.source_id', true))
  with check (source_id = current_setting('viafrei.source_id', true));
grant select, insert, update on domains.charging_points to viafrei_ingestor;

-- One merged entity per match key, the winner by source trust and then the
-- freshest, every contributing source attributed.
create view domains.charging_points_merged as
with live as (
  select r.*, coalesce(r.match_key, r.source_id || '|' || r.feed || '|' || r.external_id) as entity_key,
         s.trust, s.attribution, s.licence_id
    from domains.charging_points r left join ingestor.sources s on s.id = r.source_id
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
grant select on domains.charging_points_merged to viafrei_ingestor;
