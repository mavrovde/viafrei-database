-- The DB Timetables departure boards the MCP server fetches live, kept (#29,
-- owner ruling 2026-11-17): DB's only plan allows 60 requests a minute, so
-- not every station can be stored by a job; every board the MCP server
-- fetches for a person is handed to viafrei-api, which appends it here, and
-- the API serves a station's newest board while it is fresh.
--
-- domains.train_board_departures is a tick table: one row per departure per
-- fetch, append-only, partitioned by day on observed_at (the fetch time) like
-- the other tick tables, kept 14 days (partition_retention). Every row
-- carries the source key db_timetables, the register's attribution and the
-- licence, each fixed by a check, so a row can never claim another source or
-- licence (CC BY 4.0, no share-alike data blended in).
--
-- The API's writer role (api_access) may insert and nothing else, through
-- the insert policy; no role updates or deletes a tick. contract.train_board
-- publishes the newest fetch of each station to the API's reader.
--
-- rollback:
--   drop view contract.train_board;
--   revoke usage on schema domains from api_access;
--   delete from public.partition_retention where schema_name = 'domains' and table_name = 'train_board_departures';
--   drop table domains.train_board_departures; (its day partitions go with it)
--   delete from schema_migrations where version = 314;

create table domains.train_board_departures (
  id bigint generated always as identity,
  eva text not null check (eva ~ '^[0-9]{7}$'),
  observed_at timestamptz not null,
  planned_at timestamptz not null,
  changed_at timestamptz,
  platform text check (platform is null or (btrim(platform) <> '' and length(platform) <= 16)),
  changed_platform text check (changed_platform is null or (btrim(changed_platform) <> '' and length(changed_platform) <= 16)),
  category text check (category is null or (btrim(category) <> '' and length(category) <= 16)),
  train_number text check (train_number is null or (btrim(train_number) <> '' and length(train_number) <= 16)),
  line text check (line is null or (btrim(line) <> '' and length(line) <= 32)),
  destination text check (destination is null or (btrim(destination) <> '' and length(destination) <= 120)),
  cancelled boolean not null default false,
  source_id text not null default 'db_timetables',
  attribution text not null default 'Fahrplandaten: Deutsche Bahn AG, DB API Marketplace, CC BY 4.0, bearbeitet',
  licence text not null default 'CC BY 4.0',
  recorded_at timestamptz not null default clock_timestamp(),
  primary key (id, observed_at),
  constraint train_board_departures_source check (source_id = 'db_timetables'),
  constraint train_board_departures_attribution check (attribution = 'Fahrplandaten: Deutsche Bahn AG, DB API Marketplace, CC BY 4.0, bearbeitet'),
  constraint train_board_departures_licence check (licence = 'CC BY 4.0'),
  constraint train_board_departures_planned_near check (planned_at between observed_at - interval '1 day' and observed_at + interval '1 day'),
  constraint train_board_departures_fetch_past check (observed_at <= recorded_at + interval '5 minutes')
) partition by range (observed_at);

comment on table domains.train_board_departures is 'The DB Timetables departure boards the MCP server fetched live, one row per departure per fetch, appended by viafrei-api (api_access), partitioned by day on observed_at, with no default partition. CC BY 4.0, register key db_timetables.';
comment on column domains.train_board_departures.eva is 'The station''s EVA number the board was fetched for.';
comment on column domains.train_board_departures.observed_at is 'When the MCP server fetched the board from DB Timetables; every departure of one fetch shares it.';
comment on column domains.train_board_departures.planned_at is 'The planned departure time.';
comment on column domains.train_board_departures.changed_at is 'The changed departure time the board stated; null when it stated none.';
comment on column domains.train_board_departures.platform is 'The planned platform.';
comment on column domains.train_board_departures.changed_platform is 'The changed platform the board stated; null when it stated none.';
comment on column domains.train_board_departures.category is 'The train category (ICE, RE, S, ...).';
comment on column domains.train_board_departures.train_number is 'The train number.';
comment on column domains.train_board_departures.line is 'The line, when the board names one.';
comment on column domains.train_board_departures.destination is 'The final destination as the board names it.';
comment on column domains.train_board_departures.cancelled is 'Whether the board stated the departure as cancelled.';
comment on column domains.train_board_departures.source_id is 'Always db_timetables, the register key of the source.';
comment on column domains.train_board_departures.attribution is 'The register''s attribution of db_timetables, fixed.';
comment on column domains.train_board_departures.licence is 'Always CC BY 4.0.';
comment on column domains.train_board_departures.recorded_at is 'When the row was appended.';

create index train_board_departures_eva_fetch on domains.train_board_departures (eva, observed_at desc);
create index train_board_departures_brin on domains.train_board_departures using brin (observed_at);

-- Append-only, enforced by the database: api_access may insert a row of
-- db_timetables and nothing else, with no update or delete grant or policy.
alter table domains.train_board_departures enable row level security;
alter table domains.train_board_departures force row level security;
create policy train_board_departures_read on domains.train_board_departures for select using (true);
create policy train_board_departures_api_insert on domains.train_board_departures for insert to api_access
  with check (source_id = 'db_timetables');
grant usage on schema domains to api_access;
grant insert on domains.train_board_departures to api_access;

insert into public.partition_retention (schema_name, table_name, keep_days, archive, reason)
values ('domains', 'train_board_departures', 14, false, 'a board is served for minutes only; 14 days as the other transit ticks, then dropped: DB Timetables can be fetched again');

-- The newest fetch of each station's board, as the API serves it: the
-- departures of that fetch, with the source's attribution and licence.
create view contract.train_board as
select t.eva                                  as station_eva,
       t.observed_at                          as fetched_at,
       t.planned_at                           as planned_departure_at,
       t.changed_at                           as changed_departure_at,
       t.platform                             as platform,
       t.changed_platform                     as changed_platform,
       t.category                             as category,
       t.train_number                         as train_number,
       t.line                                 as line,
       t.destination                          as destination,
       t.cancelled                            as cancelled,
       t.attribution                          as attribution,
       t.licence                              as licence,
       t.source_id                            as source_ref,
       t.recorded_at                          as recorded_at,
       coalesce(k.display_class, 'open')      as display_class,
       coalesce(k.audience, 'public')         as audience
  from domains.train_board_departures t
  left join lateral (select k.* from public.contract_source_rules k where t.source_id ~ k.pattern order by k.priority limit 1) k on true
 where not coalesce(k.excluded, false)
   and t.observed_at = (select max(x.observed_at) from domains.train_board_departures x where x.eva = t.eva);
grant select on contract.train_board to api_reader;
comment on view contract.train_board is 'The newest fetch of each station''s DB Timetables board (domains.train_board_departures, 0314): one row per departure, with the fetch time a reader judges freshness by.';
