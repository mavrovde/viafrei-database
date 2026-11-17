-- On-demand refreshes of live sources (#41, owner rulings 2026-11-17): a
-- person's view asks viafrei-api for a refresh (POST /v1/refreshes), the API
-- records the request here, the live ingestor claims it, calls the provider
-- once and settles it in the transaction that writes the provider's rows, and
-- the API answers from the row. The provider's data never passes through this
-- schema.
--
-- The shape is the live ingestor's request protocol: live.refresh_requests with an identity id; the API inserts
-- source, subject, subject_key and requested_by; the ingestor claims by
-- setting claimed_at (state stays pending), releases a stale claim by
-- clearing it, and settles once (state, settled_at, reason, reused, where
-- settled_at is null). States: pending, refreshed, none_due, refused,
-- failed, and paused (the API's, for a source switched off).
--
-- Privacy (data-steward ruling 2026-11-17, owner-approved): a row holds only
-- public ids, never a person's position. The API resolves the subject before
-- the insert and stores only its canonical form; per source a check pins it:
-- fuel-prices-de {"at": "ags:<8 digits>" | "anchor:<BASt LCL code, 1-6
-- digits>"}, train-board-de {"eva": "<7 digits>"}, the key equal to that id.
-- Only these two sources are accepted: a new source is a migration with its
-- own subject check. requested_by is our own door only (site, mcp, or dev
-- for debugging), never null. Retention: 30 days after created_at, in any state
-- (live.prune_refresh_requests).
--
-- Two notifications:
--   live_refresh_requested  on insert, payload the source: the ingestor's wake;
--   live_refresh_settled    on settle, payload the id: the API's waiters.
--
-- One open request per (source, subject_key): the API inserts with ON
-- CONFLICT DO NOTHING and otherwise joins the open row. live.refresh_askers
-- links a request to the keys that asked (request_id, key_id, asked_at, and
-- nothing else: no position, IP or agent).
--
-- Roles: api_access inserts and reads both tables; viafrei_live_ingestor, the
-- live ingestor's own role, reads the requests, updates claimed_at, state,
-- settled_at, reason and reused, appends the train boards and writes the fuel
-- path's tables. The train boards move to the live ingestor (owner
-- 2026-11-17): the policy and grant 0314 gave api_access go to it.
--
-- rollback: remove schema live with its objects; restore 0314's train board
-- policy and grants (drop policy train_board_departures_live_insert; create
-- policy train_board_departures_api_insert ... to api_access; grant usage on
-- schema domains and insert on domains.train_board_departures to
-- api_access); revoke every grant below from viafrei_live_ingestor (the role
-- is cluster-wide and kept); delete from schema_migrations where version = 315;

set local lock_timeout = '5s';

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'viafrei_live_ingestor') THEN
    CREATE ROLE viafrei_live_ingestor WITH NOSUPERUSER NOINHERIT NOCREATEROLE NOCREATEDB LOGIN NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 10;
  ELSIF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'viafrei_live_ingestor' AND rolsuper = false AND rolinherit = false AND rolcreaterole = false AND rolcreatedb = false AND rolcanlogin = true AND rolreplication = false AND rolbypassrls = false AND rolconnlimit = 10 AND NOT EXISTS (SELECT FROM pg_catalog.pg_auth_members WHERE member = 'viafrei_live_ingestor'::regrole)) THEN
    RAISE EXCEPTION 'role viafrei_live_ingestor exists with other attributes or a membership this migration does not give it; align it first (roles are cluster-wide and never altered here)';
  END IF;
END $$;

DO $$ BEGIN EXECUTE format('ALTER ROLE viafrei_live_ingestor IN DATABASE %I SET statement_timeout TO ''30s''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE viafrei_live_ingestor IN DATABASE %I SET idle_in_transaction_session_timeout TO ''60s''', current_database()); END $$;

create schema live;
comment on schema live is 'On-demand refreshes of live sources: the requests viafrei-api records (api_access) and the live ingestor claims and settles (viafrei_live_ingestor). No provider data.';

create table live.refresh_requests (
    id           bigint generated always as identity primary key,
    source       text not null check (source in ('fuel-prices-de', 'train-board-de')),
    subject      jsonb not null check (jsonb_typeof(subject) = 'object' and length(subject::text) <= 2000),
    subject_key  text not null check (length(subject_key) between 1 and 200),
    state        text not null default 'pending' check (state in ('pending', 'refreshed', 'none_due', 'refused', 'failed', 'paused')),
    created_at   timestamptz not null default clock_timestamp(),
    claimed_at   timestamptz,
    settled_at   timestamptz,
    reason       text check (length(reason) between 1 and 200),
    reused       boolean not null default false,
    requested_by text not null check (requested_by in ('site', 'mcp', 'dev')),
    constraint refresh_requests_settled check ((state = 'pending') = (settled_at is null)),
    constraint refresh_requests_order check (claimed_at >= created_at and settled_at >= created_at),
    constraint refresh_requests_fuel_subject check (source <> 'fuel-prices-de' or (
        subject = jsonb_build_object('at', subject->>'at')
        and subject->>'at' ~ '^(ags:[0-9]{8}|anchor:[0-9]{1,6})$'
        and subject_key = subject->>'at')),
    constraint refresh_requests_train_board_subject check (source <> 'train-board-de' or (
        subject = jsonb_build_object('eva', subject->>'eva')
        and subject->>'eva' ~ '^[0-9]{7}$'
        and subject_key = subject->>'eva'))
);

comment on table live.refresh_requests is 'One on-demand refresh of a live source, shared by everyone asking about its subject while it is open. Inserted by api_access, claimed and settled by viafrei_live_ingestor. Holds public ids only (data-steward ruling 2026-11-17). Deleted 30 days after created_at by live.prune_refresh_requests.';
comment on column live.refresh_requests.id is 'The request''s id, the one the API answers (/v1/refreshes/{id}).';
comment on column live.refresh_requests.source is 'The source id of the live ingestor''s registry (fuel-prices-de, train-board-de).';
comment on column live.refresh_requests.subject is 'The subject as the API resolved it: its canonical public id only, never a position.';
comment on column live.refresh_requests.subject_key is 'The key of the registry''s subject_key rule: one open request per (source, subject_key).';
comment on column live.refresh_requests.state is 'pending (open; claimed while claimed_at is set), then refreshed, none_due, refused or failed, set once by the ingestor; paused is the API''s.';
comment on column live.refresh_requests.created_at is 'When the first asker asked; the ingestor measures its max_wait_s from it.';
comment on column live.refresh_requests.claimed_at is 'When the live ingestor claimed it; cleared again by its stale-claim sweep.';
comment on column live.refresh_requests.settled_at is 'When it settled; null while open.';
comment on column live.refresh_requests.reason is 'On refused or failed: fixed words, never a place or a provider value.';
comment on column live.refresh_requests.reused is 'True when the request joined a refresh queued or in flight, or was answered from a remembered outcome.';
comment on column live.refresh_requests.requested_by is 'The door that asked (site, mcp, or dev for debugging); the ingestor does not read it.';

create unique index refresh_requests_open on live.refresh_requests (source, subject_key) where settled_at is null;
create index refresh_requests_pending on live.refresh_requests (created_at, id) where settled_at is null;
create index refresh_requests_settled on live.refresh_requests (source, subject_key, settled_at desc) where settled_at is not null;
create index refresh_requests_created on live.refresh_requests (created_at);

create table live.refresh_askers (
    request_id bigint not null references live.refresh_requests on delete cascade,
    key_id     text not null references access.api_key,
    asked_at   timestamptz not null,
    primary key (request_id, key_id)
);

create index refresh_askers_key on live.refresh_askers (key_id);

comment on table live.refresh_askers is 'Which keys asked for a refresh: request, key and the first ask''s time, nothing else. A key reads only the requests it asked for. Written by api_access; deleted with its request.';

-- The identity columns never change; a settled row never changes; an open
-- row's claim may be set and cleared (the stale-claim sweep).
create function live.refresh_requests_transition() returns trigger
    language plpgsql set search_path = pg_catalog, live as $$
begin
    if (new.id, new.source, new.subject, new.subject_key, new.created_at, new.requested_by)
       is distinct from (old.id, old.source, old.subject, old.subject_key, old.created_at, old.requested_by) then
        raise exception 'a refresh request''s identity never changes' using errcode = 'check_violation';
    end if;
    if old.settled_at is not null and new is distinct from old then
        raise exception 'a settled refresh request never changes' using errcode = 'check_violation';
    end if;
    return new;
end;
$$;

create trigger refresh_requests_transition before update on live.refresh_requests
    for each row execute function live.refresh_requests_transition();

create function live.refresh_requests_notify() returns trigger
    language plpgsql set search_path = pg_catalog, live as $$
begin
    if tg_op = 'INSERT' then
        perform pg_notify('live_refresh_requested', new.source);
    elsif old.settled_at is null and new.settled_at is not null then
        perform pg_notify('live_refresh_settled', new.id::text);
    end if;
    return null;
end;
$$;

create trigger refresh_requests_notify after insert or update on live.refresh_requests
    for each row execute function live.refresh_requests_notify();

create function live.prune_refresh_requests(before timestamptz) returns bigint
    language plpgsql security definer set search_path = pg_catalog, live as $$
declare
    removed bigint;
begin
    if before > now() - interval '30 days' then
        raise exception 'refresh requests made less than 30 days ago are kept';
    end if;
    delete from live.refresh_requests where created_at < before;
    get diagnostics removed = row_count;
    return removed;
end;
$$;

comment on function live.prune_refresh_requests(timestamptz) is 'Deletes the refresh requests made before a date, in any state, with their askers, and returns how many; refuses a date less than 30 days ago. Run with the owner''s rights; api_access may call it.';

revoke all on function live.prune_refresh_requests(timestamptz) from public;
revoke all on function live.refresh_requests_transition() from public;
revoke all on function live.refresh_requests_notify() from public;

grant usage on schema live to api_access, viafrei_live_ingestor;
grant select, insert on live.refresh_requests, live.refresh_askers to api_access;
grant execute on function live.prune_refresh_requests(timestamptz) to api_access;
grant select on live.refresh_requests to viafrei_live_ingestor;
grant update (state, claimed_at, settled_at, reason, reused) on live.refresh_requests to viafrei_live_ingestor;

-- The train boards: appended by the live ingestor from now on.
drop policy train_board_departures_api_insert on domains.train_board_departures;
create policy train_board_departures_live_insert on domains.train_board_departures for insert to viafrei_live_ingestor
  with check (source_id = 'db_timetables');
revoke insert on domains.train_board_departures from api_access;
revoke usage on schema domains from api_access;
grant usage on schema domains to viafrei_live_ingestor;
grant insert on domains.train_board_departures to viafrei_live_ingestor;

-- The fuel path, as the live ingestor's statements write and read it.
grant select, insert (provider, started_at),
      update (finished_at, status, rows, bytes, duration_ms, note, error, body_sha256) on public.ingest_runs to viafrei_live_ingestor;
grant insert (observed_at, station_id, product, price, source_run_id) on public.fuel_prices to viafrei_live_ingestor;
grant select, insert (station_id, product, price, is_open, observed_at, source_feed, source_publisher, source_run_id, created_at, updated_at),
      update (price, is_open, observed_at, source_feed, source_publisher, source_run_id, updated_at) on public.fuel_price_latest to viafrei_live_ingestor;
grant select, insert (station_id, tier, refresh_interval_s, reason, priority, asked_at),
      update (asked_at, priority, refresh_interval_s, tier, last_polled_at, consecutive_errors, last_error) on public.fuel_station_watch to viafrei_live_ingestor;
grant select, insert (id, brand, name, street, house_no, postcode, city, geom, first_seen_at, last_seen_at, source_feed, source_publisher, source_run_id, created_at, updated_at),
      update (brand, name, street, house_no, postcode, city, geom, last_seen_at, source_feed, source_publisher, source_run_id, updated_at) on public.fuel_stations to viafrei_live_ingestor;
grant select on public.fuel_stations_live, public.fuel_price_latest_live, public.gazetteer_places, public.motorway_points_live, public.db_station_numbers
    to viafrei_live_ingestor;
grant usage on schema control to viafrei_live_ingestor;
grant select (budget_key, ceiling, spacing_ms) on control.budgets to viafrei_live_ingestor;
grant select (budget_key, caller, cap) on control.shares to viafrei_live_ingestor;
grant select on control.data_status to viafrei_live_ingestor;
grant execute on function control.admit(text, text, text), control.want(text), control.hold(text, text) to viafrei_live_ingestor;
