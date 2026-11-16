-- The access store of viafrei-api (#29): schema access and the API's own role
-- api_access. Until this release the API built both itself (its db/access
-- 0001-0004, in four steps); this file builds the same store in one, in the
-- shape those four steps leave: the same tables, columns, types, constraint
-- and index names, functions, grants and access.schema_version rows 1-3, so
-- the API, which reads schema_version, sees the store it expects.
-- test/api-schemas.db.test.ts holds it to that.
--
-- It holds no secret: a key is stored as the MAC of its secret under a pepper
-- that lives outside this database, a console passkey as its public key, an
-- enrolment code as its MAC. Console sessions and challenges stay in the
-- service's memory.
--
-- api_access may read and change plans and keys, record acceptances and
-- usage, and manage the console's passkeys and enrolment codes; audit records
-- are append-only for it (insert and select, never update or delete), and old
-- audit and usage rows leave only through access.prune_audit and
-- access.prune_usage, which run with the owner's rights and never remove a row
-- younger than 30 days. It holds nothing outside the schema access. Its
-- settings are made IN DATABASE (db/roles/settings.sql), not for every
-- database as the API's DDL made them; its password comes from the roles step
-- (db/roles/api-access-role-password.sql), never from this file.
--
-- rollback: drop schema access cascade; then, in every database of the
-- cluster that no longer needs it, `reassign owned by api_access to <owner>;
-- drop owned by api_access;` and once in the cluster `drop role api_access;`.
-- The store's rows (keys, plans, audit) go with the schema: dump it first.
--   delete from schema_migrations where version = 308;

-- The lint reads ALTER ROLE as a strong lock; it takes none on a table, but
-- the bound costs nothing.
set local lock_timeout = '5s';

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'api_access') THEN
    CREATE ROLE api_access WITH NOSUPERUSER NOINHERIT NOCREATEROLE NOCREATEDB LOGIN NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 8;
  ELSIF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'api_access' AND rolsuper = false AND rolinherit = false AND rolcreaterole = false AND rolcreatedb = false AND rolcanlogin = true AND rolreplication = false AND rolbypassrls = false AND rolconnlimit = 8) THEN
    RAISE EXCEPTION 'role api_access exists with other attributes than this migration gives it; align it first (role attributes are cluster-wide and never altered here)';
  END IF;
END $$;

DO $$ BEGIN EXECUTE format('ALTER ROLE api_access IN DATABASE %I SET statement_timeout TO ''2s''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE api_access IN DATABASE %I SET idle_in_transaction_session_timeout TO ''5s''', current_database()); END $$;

create schema access;
comment on schema access is 'The access store of viafrei-api: plans, keys (as MACs), terms acceptances, usage, the audit and the owner console''s passkeys. Written by the role api_access alone.';

create table access.schema_version (
    version    integer primary key,
    applied_at timestamptz not null default now()
);

-- Plans are data, changeable without a deployment.
create table access.plan (
    plan_name       text primary key check (plan_name ~ '^[a-z][a-z0-9_-]{0,31}$'),
    use_class       text not null check (use_class in ('consumer', 'non_commercial', 'commercial')),
    tier            text not null check (tier in ('critical', 'standard', 'bulk')),
    scopes          text[] not null,
    sources         text[] not null,
    changed_at      timestamptz not null,
    rate_per_second integer not null check (rate_per_second between 1 and 100000),
    burst           integer not null check (burst between 1 and 100000),
    quota_day       bigint  not null check (quota_day >= 0),
    quota_month     bigint  not null check (quota_month >= 0)
);

create table access.api_key (
    key_id         text primary key check (key_id ~ '^[0-9A-Za-z]{10}$'),
    environment    text not null check (environment in ('live', 'test')),
    plan_name      text not null references access.plan,
    label          text not null,
    contact        text not null,
    mac            bytea not null check (length(mac) = 32),
    previous_mac   bytea check (length(previous_mac) = 32),
    previous_until timestamptz,
    issued_at      timestamptz not null,
    expires_at     timestamptz not null,
    revoked_at     timestamptz,
    revoke_reason  text,
    changed_at     timestamptz not null,
    constraint api_key_check check ((previous_mac is null) = (previous_until is null)),
    constraint api_key_check1 check ((revoked_at is null) = (revoke_reason is null))
);

create index api_key_changed_at on access.api_key (changed_at);
create index plan_changed_at on access.plan (changed_at);

-- One row per accepted terms version of one source family.
create table access.terms_acceptance (
    key_id        text not null references access.api_key,
    source_family text not null,
    terms_version text not null,
    accepted_at   timestamptz not null,
    primary key (key_id, source_family, terms_version)
);

-- Every lifecycle action, written in the transaction of the change. No
-- secret, no MAC, no client address.
create table access.audit (
    audit_id    bigint generated always as identity primary key,
    at          timestamptz not null,
    action      text not null,
    key_id      text,
    plan_before text,
    plan_after  text,
    actor       text not null,
    reason      text,
    constraint audit_action_check check (action in ('plan_put', 'plan_move', 'issue', 'rotate', 'revoke', 'accept_terms', 'audit_pruned', 'usage_pruned',
                                                    'console_enrolment', 'console_passkey_added', 'console_passkey_removed', 'console_sign_in'))
);

create index audit_at on access.audit (at);

-- One row per key, hour (its start, UTC) and operation. The metering adds to
-- a row in one batched write per interval; no request writes here. It holds
-- no client address.
create table access.usage (
    key_id             text        not null references access.api_key,
    hour               timestamptz not null,
    operation          text        not null check (operation ~ '^[A-Za-z][A-Za-z0-9]{0,63}$'),
    requests           bigint      not null check (requests >= 0),
    not_modified       bigint      not null check (not_modified >= 0),
    rate_limited       bigint      not null check (rate_limited >= 0),
    quota_exceeded     bigint      not null check (quota_exceeded >= 0),
    overloaded         bigint      not null check (overloaded >= 0),
    deadline_exhausted bigint      not null check (deadline_exhausted >= 0),
    storage_ms         bigint      not null check (storage_ms >= 0),
    primary key (key_id, hour, operation)
);

create index usage_hour on access.usage (hour);

-- The owner console: a passkey is stored as its public key only, an enrolment
-- code as its MAC under the pepper, like a key secret.
create table access.console_passkey (
    credential_id bytea primary key check (length(credential_id) between 16 and 1023),
    owner_name    text not null check (owner_name ~ '^[a-z][a-z0-9._-]{0,31}$'),
    user_handle   bytea not null check (length(user_handle) = 32),
    public_key    bytea not null check (length(public_key) between 1 and 2048),
    sign_count    bigint not null check (sign_count between 0 and 4294967295),
    flags         smallint not null check (flags between 0 and 255),
    created_at    timestamptz not null,
    last_used_at  timestamptz
);

create index console_passkey_owner on access.console_passkey (owner_name);

create table access.console_enrolment (
    code_mac   bytea primary key check (length(code_mac) = 32),
    owner_name text not null check (owner_name ~ '^[a-z][a-z0-9._-]{0,31}$'),
    expires_at timestamptz not null,
    used_at    timestamptz
);

-- The one way to remove audit records: older than the retention, and never
-- younger than 30 days whatever the caller asks. It runs with the owner's
-- rights, so api_access needs no delete right on the table.
create function access.prune_audit(before timestamptz) returns bigint
    language plpgsql security definer set search_path = pg_catalog, access as $$
declare
    removed bigint;
begin
    if before > now() - interval '30 days' then
        raise exception 'audit records younger than 30 days are kept';
    end if;
    delete from access.audit where at < before;
    get diagnostics removed = row_count;
    return removed;
end;
$$;

-- The one way to remove usage records, the same way.
create function access.prune_usage(keep_days integer) returns bigint
    language plpgsql security definer set search_path = pg_catalog, access as $$
declare
    removed bigint;
begin
    if keep_days < 30 then
        raise exception 'usage records younger than 30 days are kept';
    end if;
    delete from access.usage where hour < now() - make_interval(days => keep_days);
    get diagnostics removed = row_count;
    return removed;
end;
$$;

revoke all on function access.prune_audit(timestamptz) from public;
revoke all on function access.prune_usage(integer) from public;

grant usage on schema access to api_access;
grant select on access.schema_version to api_access;
grant select, insert, update on access.plan, access.api_key, access.usage to api_access;
grant select, insert on access.terms_acceptance, access.audit to api_access;
grant select, insert, update, delete on access.console_passkey, access.console_enrolment to api_access;
grant execute on function access.prune_audit(timestamptz), access.prune_usage(integer) to api_access;

-- The store's versions the API's own steps 0001, 0003 and 0004 wrote.
insert into access.schema_version (version) values (1), (2), (3);
