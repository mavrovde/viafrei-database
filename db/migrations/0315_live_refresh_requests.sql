-- On-demand refreshes of live sources (#41, owner rulings 2026-11-17): a
-- person's view asks viafrei-api for a refresh (POST /v1/refreshes), the API
-- records the ask here, the live ingestor claims it, calls the provider once
-- and settles it, and the API answers the askers from the row. The provider's
-- data never passes through this schema: the ingestor stores it in its own
-- tables, which the API serves under their own resources.
--
-- live.refresh_request is one refresh: a source the API's registry names, the
-- subject as asked (a JSON object), and subject_key, the canonical subject the
-- API builds from the registry's key rules, so that every person asking about
-- one subject while it is open shares ONE row: at most one open (pending or
-- claimed) row per (source, subject_key), held by a unique partial index; the
-- API inserts with ON CONFLICT DO NOTHING and otherwise joins the open row.
-- live.refresh_asker records who asked: one row per request and key.
--
-- A request moves pending -> claimed -> settled (refreshed, none_due, refused
-- or failed), or straight from pending to settled; a settled row never
-- changes again (refresh_request_transition). Two notifications:
--   refresh_request            on insert, payload the request id: the live
--                              ingestor's wake-up;
--   refresh_<id, 32 hex>       on settle, payload the state: the API's
--                              waiters on that row.
--
-- Roles: api_access inserts and reads both tables and nothing else here;
-- viafrei_ingestor reads the requests and updates only state, claimed_at,
-- settled_at and reason. Retention: live.prune_refresh_requests removes
-- settled requests (and their askers) older than a date, never one younger
-- than 30 days, with the owner's rights, as access.prune_usage does.
--
-- The train boards move to the live ingestor (owner 2026-11-17): it appends
-- them, under the policy and grant 0314 gave api_access, which loses both.
--
-- rollback: drop schema live cascade; then restore 0314's train board policy
-- and grants: drop policy train_board_departures_ingestor_insert on
-- domains.train_board_departures; revoke insert on
-- domains.train_board_departures from viafrei_ingestor; create policy
-- train_board_departures_api_insert ... to api_access (as in 0314); grant
-- usage on schema domains to api_access; grant insert on
-- domains.train_board_departures to api_access;
--   delete from schema_migrations where version = 315;

set local lock_timeout = '5s';

create schema live;
comment on schema live is 'On-demand refreshes of live sources: the asks viafrei-api records (api_access) and the live ingestor claims and settles (viafrei_ingestor). No provider data.';

create table live.refresh_request (
    request_id  uuid primary key,
    source      text not null check (source ~ '^[a-z][a-z0-9_]{0,31}$'),
    subject     jsonb not null check (jsonb_typeof(subject) = 'object' and length(subject::text) <= 2000),
    subject_key text not null check (length(subject_key) between 1 and 200),
    state       text not null default 'pending' check (state in ('pending', 'claimed', 'refreshed', 'none_due', 'refused', 'failed')),
    created_at  timestamptz not null,
    claimed_at  timestamptz,
    settled_at  timestamptz,
    reason      text check (length(reason) between 1 and 200),
    constraint refresh_request_settled check ((state in ('pending', 'claimed')) = (settled_at is null)),
    constraint refresh_request_claimed check (state <> 'claimed' or claimed_at is not null),
    constraint refresh_request_order check (claimed_at >= created_at and settled_at >= coalesce(claimed_at, created_at))
);

comment on table live.refresh_request is 'One on-demand refresh of a live source, shared by everyone asking about its subject while it is open. Written by api_access (insert) and viafrei_ingestor (claim, settle). Pruned 30 days after settling by live.prune_refresh_requests.';
comment on column live.refresh_request.request_id is 'The id the API answers (/v1/refreshes/{id}), made by the API.';
comment on column live.refresh_request.source is 'The live source, a name of the API''s configured registry.';
comment on column live.refresh_request.subject is 'The subject as first asked, a JSON object valid under the source''s registered schema.';
comment on column live.refresh_request.subject_key is 'The canonical subject the API built from the registry''s key rules: one open request per (source, subject_key).';
comment on column live.refresh_request.state is 'pending (not yet claimed), claimed (the ingestor runs it), then refreshed, none_due, refused or failed (settled, final).';
comment on column live.refresh_request.created_at is 'When the first asker asked.';
comment on column live.refresh_request.claimed_at is 'When the live ingestor claimed it; null before.';
comment on column live.refresh_request.settled_at is 'When it settled; null while open.';
comment on column live.refresh_request.reason is 'Why a request was refused or failed, when known: no provider data.';

-- One open request per subject; the ingestor claims the oldest pending first;
-- the API reads the newest settled one inside a source's freshness window.
create unique index refresh_request_open on live.refresh_request (source, subject_key) where state in ('pending', 'claimed');
create index refresh_request_pending on live.refresh_request (created_at) where state = 'pending';
create index refresh_request_settled on live.refresh_request (source, subject_key, settled_at desc) where settled_at is not null;
create index refresh_request_prune on live.refresh_request (settled_at);

create table live.refresh_asker (
    request_id uuid not null references live.refresh_request on delete cascade,
    key_id     text not null references access.api_key,
    asked_at   timestamptz not null,
    primary key (request_id, key_id)
);

create index refresh_asker_key on live.refresh_asker (key_id);

comment on table live.refresh_asker is 'Who asked for a refresh: one row per request and key, the first ask kept. A key reads only the requests it asked for. Written by api_access.';

-- pending -> claimed -> settled, or pending -> settled; a settled row and the
-- identity columns never change.
create function live.refresh_request_transition() returns trigger
    language plpgsql set search_path = pg_catalog, live as $$
begin
    if (new.request_id, new.source, new.subject, new.subject_key, new.created_at)
       is distinct from (old.request_id, old.source, old.subject, old.subject_key, old.created_at) then
        raise exception 'a refresh request''s identity never changes' using errcode = 'check_violation';
    end if;
    if old.state not in ('pending', 'claimed') and new is distinct from old then
        raise exception 'a settled refresh request never changes' using errcode = 'check_violation';
    end if;
    if old.state = 'claimed' and new.state = 'pending' then
        raise exception 'a claimed refresh request does not return to pending' using errcode = 'check_violation';
    end if;
    return new;
end;
$$;

create trigger refresh_request_transition before update on live.refresh_request
    for each row execute function live.refresh_request_transition();

create function live.refresh_request_notify() returns trigger
    language plpgsql set search_path = pg_catalog, live as $$
begin
    if tg_op = 'INSERT' then
        perform pg_notify('refresh_request', new.request_id::text);
    elsif old.settled_at is null and new.settled_at is not null then
        perform pg_notify('refresh_' || replace(new.request_id::text, '-', ''), new.state);
    end if;
    return null;
end;
$$;

create trigger refresh_request_notify after insert or update on live.refresh_request
    for each row execute function live.refresh_request_notify();

create function live.prune_refresh_requests(before timestamptz) returns bigint
    language plpgsql security definer set search_path = pg_catalog, live as $$
declare
    removed bigint;
begin
    if before > now() - interval '30 days' then
        raise exception 'refresh requests settled less than 30 days ago are kept';
    end if;
    delete from live.refresh_request where settled_at < before;
    get diagnostics removed = row_count;
    return removed;
end;
$$;

comment on function live.prune_refresh_requests(timestamptz) is 'Removes the refresh requests settled before a date, with their askers, and returns how many; refuses a date less than 30 days ago. Run with the owner''s rights; api_access may call it.';

revoke all on function live.prune_refresh_requests(timestamptz) from public;
revoke all on function live.refresh_request_transition() from public;
revoke all on function live.refresh_request_notify() from public;

grant usage on schema live to api_access, viafrei_ingestor;
grant select, insert on live.refresh_request, live.refresh_asker to api_access;
grant execute on function live.prune_refresh_requests(timestamptz) to api_access;
grant select on live.refresh_request to viafrei_ingestor;
grant update (state, claimed_at, settled_at, reason) on live.refresh_request to viafrei_ingestor;

-- The train boards: appended by the live ingestor from now on.
drop policy train_board_departures_api_insert on domains.train_board_departures;
create policy train_board_departures_ingestor_insert on domains.train_board_departures for insert to viafrei_ingestor
  with check (source_id = 'db_timetables');
revoke insert on domains.train_board_departures from api_access;
revoke usage on schema domains from api_access;
grant insert on domains.train_board_departures to viafrei_ingestor;
