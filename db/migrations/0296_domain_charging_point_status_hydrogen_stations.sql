-- domains.charging_point_status and domains.hydrogen_stations.
--
-- domains.charging_point_status: the dynamic status of a charge point, one row
-- per observation, the old public.charging_point_status's shape in the domain
-- shape of domains.speed_cameras. A status is a series, so the table is a tick
-- table: append-only (no update policy, no UPDATE grant, no merged view),
-- partitioned by day on observed_at and with NO default partition, like every
-- tick table of this schema: a tick outside the covered days is refused. The
-- owner key carries observed_at, so a source writes a point's status once per
-- observation and a repeat of the same observation is a no-op.
--
-- external_id is the point's key as its publisher states it (the EVSE id where
-- the publisher keys by one); evse_id is the EVSE id when it is a valid one;
-- site_key is the old site_id. Ticks of one run share one observed_at, or one
-- source_run_id, so a reader can tell a run apart from the next one.
--
-- ensure_daily_partitions now keeps the tick tables of schema domains on the
-- daily schedule as well as those of the current schema, so check and /ready
-- see this table covered. The floor in partition_settings still counts the
-- current schema's tick tables only.
--
-- public.partition_retention: how long each day partition of a tick table is
-- kept and whether it is archived to the cold store before it is dropped,
-- read by the partition retention job. A tick table of schema domains must
-- have its row: ensure_daily_partitions refuses one that has none.
-- domains.charging_point_status keeps 14 days, then the cold store, as its old
-- twin public.charging_point_status does.
--
-- domains.hydrogen_stations: hydrogen refuelling stations, one row per station
-- and source, a state table with the trust-ranked _merged view.
--
-- The merged view's (w).* and r.* were expanded when it was created: a later
-- migration that adds a column to domains.hydrogen_stations must drop and
-- recreate hydrogen_stations_merged, or the view goes on without that column.
--
-- Nothing reads these tables yet and no reader is granted them. The old tables
-- and their data are not touched.
--
-- rollback: drop view domains.hydrogen_stations_merged; drop table domains.hydrogen_stations;
--   drop table public.partition_retention;
--   drop table domains.charging_point_status; (its day partitions go with it)
--   restore ensure_daily_partitions from db/baseline/0293_baseline.sql;
--   delete from schema_migrations where version = 296;

create or replace function public.ensure_daily_partitions(days_ahead integer default 7) returns void
    language plpgsql
    AS $$
declare
  days_back constant integer := 3;
  min_tick_tables integer;
  daily_exempt constant text[] := '{}';
  schemas text[];
  s text; t text; d date; part text;
  covered text[]; n integer; total integer := 0; made integer := 0; stray text;
  summarized integer := 0;
begin
  schemas := array[current_schema()::text];
  if current_schema() <> 'domains' and to_regnamespace('domains') is not null then
    schemas := schemas || 'domains'::text;
  end if;

  foreach s in array schemas loop
    select coalesce(array_agg(c.relname::text order by c.relname), '{}')
      into covered
      from pg_partitioned_table p
      join pg_class c on c.oid = p.partrelid
      join pg_namespace ns on ns.oid = c.relnamespace
     where ns.nspname = s
       and p.partstrat = 'r'
       and p.partnatts = 1
       and (select a.attname from pg_attribute a
             where a.attrelid = c.oid and a.attnum = p.partattrs[0]) = 'observed_at';
    n := coalesce(array_length(covered, 1), 0);

    if s = current_schema() then
      select ps.min_daily_tables into min_tick_tables from partition_settings ps where ps.singleton;
      if min_tick_tables is null then
        raise exception 'ensure_daily_partitions: no row in partition_settings, so the floor of tick tables is unknown — restore it (insert into partition_settings (min_daily_tables) values (<count of tick tables>)) rather than run without one.';
      end if;
      if n < min_tick_tables then
        raise exception 'ensure_daily_partitions: % range-partitioned table(s) keyed on observed_at in schema %, expected at least % — a tick table has left the daily schedule (renamed, un-partitioned, or its partition key is no longer observed_at). Covered: %.',
          n, s, min_tick_tables, covered;
      end if;
    end if;

    select string_agg(format('%s partitioned by %s', c.relname, pg_get_partkeydef(c.oid)), '; ' order by c.relname)
      into stray
      from pg_partitioned_table p
      join pg_class c on c.oid = p.partrelid
      join pg_namespace ns on ns.oid = c.relnamespace
     where ns.nspname = s
       and p.partstrat = 'r'
       and not (c.relname = any(covered))
       and not (c.relname = any(coalesce(daily_exempt, '{}')));
    if stray is not null then
      raise exception 'ensure_daily_partitions: range-partitioned table(s) outside the daily schedule in schema %: %. A tick table joins the schedule by being range-partitioned on a single observed_at column — key it that way, or add it to daily_exempt in a new migration and say why. It currently gets NO partitions, and its first insert fails with "no partition of relation ... found for row".',
        s, stray;
    end if;

    if s = 'domains' then
      select string_agg(x, ', ' order by x) into stray
        from unnest(covered) x
       where not exists (select 1 from partition_retention r where r.schema_name = s and r.table_name = x);
      if stray is not null then
        raise exception 'ensure_daily_partitions: tick table(s) of schema % without a row in partition_retention: %. Add the row (how many days a day partition is kept, and whether it is archived first) in the migration that creates the table.',
          s, stray;
      end if;
    end if;

    foreach t in array covered loop
      for i in -days_back..days_ahead loop
        d := (current_date + i);
        part := format('%s_%s', t, to_char(d, 'YYYYMMDD'));
        if to_regclass(format('%I.%I', s, part)) is null then
          execute format('create table %I.%I (like %I.%I including all excluding indexes excluding statistics)', s, part, s, t);
          execute format('alter table %I.%I attach partition %I.%I for values from (%L) to (%L)',
                         s, t, s, part, d::timestamptz, (d + 1)::timestamptz);
          made := made + 1;
        end if;
        summarized := summarized + tick_brin_autosummarize(format('%I.%I', s, part)::regclass);
      end loop;
    end loop;
    total := total + n;
  end loop;

  raise notice 'ensure_daily_partitions: % table(s) on the daily schedule in schema(s) %, days % .. %, % partition(s) created, % BRIN index(es) set to autosummarize',
    total, array_to_string(schemas, ', '), current_date - days_back, current_date + days_ahead, made, summarized;
end $$;

create table public.partition_retention (
  schema_name text not null,
  table_name text not null,
  keep_days integer not null,
  archive boolean not null,
  reason text not null,
  primary key (schema_name, table_name),
  constraint partition_retention_keep_days check (keep_days >= 1),
  constraint partition_retention_reason check (reason <> '')
);

comment on table public.partition_retention is 'How long the day partitions of a tick table are kept, and whether each is archived to the cold store before it is dropped. Read by the partition retention job; a tick table of schema domains must have its row.';
comment on column public.partition_retention.keep_days is 'Day partitions older than this many days are retired.';
comment on column public.partition_retention.archive is 'True: dumped to the cold store and verified before the drop. False: dropped without a dump.';

create table domains.charging_point_status (
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
  evse_id text,
  site_key text,
  station_id text,
  status text,
  operation_status text,
  opening_status text,
  exchange_protocol text,
  feed_ts timestamptz,
  last_updated timestamptz,
  confidentiality text,
  source_run_id bigint,
  primary key (id, observed_at),
  constraint charging_point_status_owner_key unique (source_id, feed, external_id, observed_at),
  constraint charging_point_status_geom_point check (geom is null or GeometryType(geom) = 'POINT')
) partition by range (observed_at);

comment on table domains.charging_point_status is 'The dynamic status of charge points, one row per observation and source, append-only and partitioned by day on observed_at, with no default partition.';
comment on column domains.charging_point_status.external_id is 'The point''s key as its publisher states it: the EVSE id where the publisher keys by one.';
comment on column domains.charging_point_status.evse_id is 'The point''s EVSE id when it is a valid one; null otherwise.';
comment on column domains.charging_point_status.site_key is 'The publisher''s site of the point, when it names one.';
comment on column domains.charging_point_status.station_id is 'The publisher''s station of the point, when it names one.';
comment on column domains.charging_point_status.status is 'The point''s status as published (available, occupied, faulted, ...).';
comment on column domains.charging_point_status.exchange_protocol is 'How the publisher delivers the status: a full snapshot, or a delta (deltaPull) that states only what changed.';
comment on column domains.charging_point_status.feed_ts is 'The publication''s own timestamp, verbatim.';
comment on column domains.charging_point_status.last_updated is 'When the publisher says this point''s status last changed, verbatim.';
comment on column domains.charging_point_status.confidentiality is 'The DATEX II confidentiality the publisher marks; a reader shows only noRestriction or null.';
comment on column domains.charging_point_status.source_run_id is 'The writer''s run that observed the status, so the ticks of one run can be told apart.';

create index charging_point_status_match on domains.charging_point_status (match_key) where closed_at is null;
create index charging_point_status_owner_open on domains.charging_point_status (source_id, feed) where closed_at is null;
create index charging_point_status_geom on domains.charging_point_status using gist (geom);
create index charging_point_status_brin on domains.charging_point_status using brin (observed_at);
create index charging_point_status_evse on domains.charging_point_status (evse_id, observed_at desc) where evse_id is not null;

-- Own rows only, enforced by the database: a writer may insert a row only when
-- its source_id is the transaction's viafrei.source_id AND that source is
-- registered for this domain. No setting, no write. Ticks are append-only: no
-- update policy and no UPDATE grant.
alter table domains.charging_point_status enable row level security;
alter table domains.charging_point_status force row level security;
create policy charging_point_status_read on domains.charging_point_status for select using (true);
create policy charging_point_status_own_insert on domains.charging_point_status for insert to viafrei_ingestor
  with check (source_id = current_setting('viafrei.source_id', true)
              and exists (select 1 from ingestor.sources s where s.id = source_id and s.domain = 'charging_point_status'));
grant select, insert on domains.charging_point_status to viafrei_ingestor;

insert into public.partition_retention (schema_name, table_name, keep_days, archive, reason)
values ('domains', 'charging_point_status', 14, true, 'as its old twin public.charging_point_status: 14 days, then the cold store, because a delta feed''s status cannot be fetched again');

create table domains.hydrogen_stations (
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
  name text,
  operator text,
  brand text,
  address jsonb,
  refill jsonb not null,
  opening jsonb,
  source_publisher text,
  provider_updated_at timestamptz,
  last_seen_at timestamptz,
  primary key (id),
  constraint hydrogen_stations_owner_key unique (source_id, feed, external_id),
  constraint hydrogen_stations_geom_point check (geom is null or GeometryType(geom) = 'POINT'),
  constraint hydrogen_stations_refill_nonempty check (jsonb_typeof(refill) = 'array' and jsonb_array_length(refill) > 0),
  constraint hydrogen_stations_address_object check (address is null or jsonb_typeof(address) = 'object')
);

comment on table domains.hydrogen_stations is 'Hydrogen refuelling stations, one row per station and source: where it is, who runs it, its refill points and its opening times.';
comment on column domains.hydrogen_stations.address is 'The station''s address as a JSON object, as published.';
comment on column domains.hydrogen_stations.refill is 'A non-empty JSON array of the refill points as published (pressure, vehicle class, state).';
comment on column domains.hydrogen_stations.opening is 'The opening times as published, JSON.';
comment on column domains.hydrogen_stations.source_publisher is 'The publisher behind the source, when the source relays another''s data.';
comment on column domains.hydrogen_stations.provider_updated_at is 'When the publisher says the station''s data last changed, verbatim.';
comment on column domains.hydrogen_stations.last_seen_at is 'The last run that saw the station in its source, set by the writer on every run (observed_at moves only when the row changes).';

create index hydrogen_stations_match on domains.hydrogen_stations (match_key) where closed_at is null;
create index hydrogen_stations_owner_open on domains.hydrogen_stations (source_id, feed) where closed_at is null;
create index hydrogen_stations_geom on domains.hydrogen_stations using gist (geom);

-- Own rows only, enforced by the database: a writer may insert or update a row
-- only when its source_id is the transaction's viafrei.source_id AND that
-- source is registered for this domain. No setting, no write.
alter table domains.hydrogen_stations enable row level security;
alter table domains.hydrogen_stations force row level security;
create policy hydrogen_stations_read on domains.hydrogen_stations for select using (true);
create policy hydrogen_stations_own_insert on domains.hydrogen_stations for insert to viafrei_ingestor
  with check (source_id = current_setting('viafrei.source_id', true)
              and exists (select 1 from ingestor.sources s where s.id = source_id and s.domain = 'hydrogen_stations'));
create policy hydrogen_stations_own_update on domains.hydrogen_stations for update to viafrei_ingestor
  using (source_id = current_setting('viafrei.source_id', true))
  with check (source_id = current_setting('viafrei.source_id', true));
grant select, insert, update on domains.hydrogen_stations to viafrei_ingestor;

-- One merged entity per match key, the winner by source trust and then the
-- freshest, every contributing source attributed.
create view domains.hydrogen_stations_merged as
with live as (
  select r.*, coalesce(r.match_key, r.source_id || '|' || r.feed || '|' || r.external_id) as entity_key,
         s.trust, s.attribution, s.licence_id
    from domains.hydrogen_stations r left join ingestor.sources s on s.id = r.source_id
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
grant select on domains.hydrogen_stations_merged to viafrei_ingestor;
