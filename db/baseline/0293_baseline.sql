-- The ViaFrei schema at version 293: what migrations 0001..0293 build on an
-- empty database (a plain `create database`), as one file, privileges included.
-- Applied by `migrate` on an EMPTY database only (one the PostGIS image made,
-- holding its init's extras, is empty too), in one transaction with the
-- ledger rows of db/baseline/ledger.tsv. Generated
-- by scripts/baseline.sh; never edited (`viafrei-db lint` refuses an edit): write
-- a migration after it.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'viafrei_digest') THEN
    CREATE ROLE viafrei_digest WITH NOSUPERUSER INHERIT NOCREATEROLE NOCREATEDB LOGIN NOREPLICATION NOBYPASSRLS;
  ELSIF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'viafrei_digest' AND rolsuper = false AND rolinherit = true AND rolcreaterole = false AND rolcreatedb = false AND rolcanlogin = true AND rolreplication = false AND rolbypassrls = false) THEN
    RAISE EXCEPTION 'role viafrei_digest exists with other attributes than the baseline gives it; align it first (role attributes are cluster-wide and never altered here)';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'viafrei_ingestor') THEN
    CREATE ROLE viafrei_ingestor WITH NOSUPERUSER INHERIT NOCREATEROLE NOCREATEDB LOGIN NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 60;
  ELSIF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'viafrei_ingestor' AND rolsuper = false AND rolinherit = true AND rolcreaterole = false AND rolcreatedb = false AND rolcanlogin = true AND rolreplication = false AND rolbypassrls = false AND rolconnlimit = 60) THEN
    RAISE EXCEPTION 'role viafrei_ingestor exists with other attributes than the baseline gives it; align it first (role attributes are cluster-wide and never altered here)';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'viafrei_mcp') THEN
    CREATE ROLE viafrei_mcp WITH NOSUPERUSER INHERIT NOCREATEROLE NOCREATEDB LOGIN NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 32;
  ELSIF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'viafrei_mcp' AND rolsuper = false AND rolinherit = true AND rolcreaterole = false AND rolcreatedb = false AND rolcanlogin = true AND rolreplication = false AND rolbypassrls = false AND rolconnlimit = 32) THEN
    RAISE EXCEPTION 'role viafrei_mcp exists with other attributes than the baseline gives it; align it first (role attributes are cluster-wide and never altered here)';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'viafrei_ops') THEN
    CREATE ROLE viafrei_ops WITH NOSUPERUSER INHERIT NOCREATEROLE NOCREATEDB LOGIN NOREPLICATION NOBYPASSRLS;
  ELSIF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'viafrei_ops' AND rolsuper = false AND rolinherit = true AND rolcreaterole = false AND rolcreatedb = false AND rolcanlogin = true AND rolreplication = false AND rolbypassrls = false) THEN
    RAISE EXCEPTION 'role viafrei_ops exists with other attributes than the baseline gives it; align it first (role attributes are cluster-wide and never altered here)';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'viafrei_status') THEN
    CREATE ROLE viafrei_status WITH NOSUPERUSER INHERIT NOCREATEROLE NOCREATEDB LOGIN NOREPLICATION NOBYPASSRLS;
  ELSIF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'viafrei_status' AND rolsuper = false AND rolinherit = true AND rolcreaterole = false AND rolcreatedb = false AND rolcanlogin = true AND rolreplication = false AND rolbypassrls = false) THEN
    RAISE EXCEPTION 'role viafrei_status exists with other attributes than the baseline gives it; align it first (role attributes are cluster-wide and never altered here)';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'viafrei_translate') THEN
    CREATE ROLE viafrei_translate WITH NOSUPERUSER INHERIT NOCREATEROLE NOCREATEDB LOGIN NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 4;
  ELSIF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'viafrei_translate' AND rolsuper = false AND rolinherit = true AND rolcreaterole = false AND rolcreatedb = false AND rolcanlogin = true AND rolreplication = false AND rolbypassrls = false AND rolconnlimit = 4) THEN
    RAISE EXCEPTION 'role viafrei_translate exists with other attributes than the baseline gives it; align it first (role attributes are cluster-wide and never altered here)';
  END IF;
END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE CURRENT_USER IN DATABASE %I SET work_mem TO ''16MB''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE CURRENT_USER IN DATABASE %I SET hash_mem_multiplier TO ''1.0''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE CURRENT_USER IN DATABASE %I SET max_parallel_workers_per_gather TO ''0''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE CURRENT_USER IN DATABASE %I SET jit TO ''off''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE CURRENT_USER IN DATABASE %I SET maintenance_work_mem TO ''64MB''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE CURRENT_USER IN DATABASE %I SET max_parallel_maintenance_workers TO ''0''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE viafrei_digest IN DATABASE %I SET statement_timeout TO ''5s''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE viafrei_digest IN DATABASE %I SET default_transaction_read_only TO ''on''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE viafrei_digest IN DATABASE %I SET idle_in_transaction_session_timeout TO ''10s''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE viafrei_digest IN DATABASE %I SET "TimeZone" TO ''UTC''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE viafrei_digest IN DATABASE %I SET jit TO ''off''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE viafrei_digest IN DATABASE %I SET work_mem TO ''16MB''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE viafrei_digest IN DATABASE %I SET hash_mem_multiplier TO ''1.0''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE viafrei_digest IN DATABASE %I SET max_parallel_workers_per_gather TO ''0''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE viafrei_digest IN DATABASE %I SET log_parameter_max_length TO ''0''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE viafrei_digest IN DATABASE %I SET log_parameter_max_length_on_error TO ''0''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE viafrei_ingestor IN DATABASE %I SET statement_timeout TO ''120s''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE viafrei_ingestor IN DATABASE %I SET idle_in_transaction_session_timeout TO ''300s''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE viafrei_ingestor IN DATABASE %I SET "TimeZone" TO ''UTC''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE viafrei_mcp IN DATABASE %I SET statement_timeout TO ''10s''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE viafrei_mcp IN DATABASE %I SET idle_in_transaction_session_timeout TO ''30s''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE viafrei_mcp IN DATABASE %I SET "TimeZone" TO ''UTC''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE viafrei_mcp IN DATABASE %I SET jit TO ''off''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE viafrei_mcp IN DATABASE %I SET work_mem TO ''16MB''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE viafrei_mcp IN DATABASE %I SET hash_mem_multiplier TO ''1.0''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE viafrei_mcp IN DATABASE %I SET max_parallel_workers_per_gather TO ''1''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE viafrei_ops IN DATABASE %I SET statement_timeout TO ''5s''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE viafrei_ops IN DATABASE %I SET idle_in_transaction_session_timeout TO ''10s''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE viafrei_ops IN DATABASE %I SET "TimeZone" TO ''UTC''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE viafrei_status IN DATABASE %I SET statement_timeout TO ''5s''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE viafrei_status IN DATABASE %I SET default_transaction_read_only TO ''on''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE viafrei_status IN DATABASE %I SET idle_in_transaction_session_timeout TO ''10s''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE viafrei_status IN DATABASE %I SET "TimeZone" TO ''UTC''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE viafrei_status IN DATABASE %I SET jit TO ''off''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE viafrei_translate IN DATABASE %I SET statement_timeout TO ''2s''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE viafrei_translate IN DATABASE %I SET lock_timeout TO ''1s''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE viafrei_translate IN DATABASE %I SET idle_in_transaction_session_timeout TO ''10s''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE viafrei_translate IN DATABASE %I SET "TimeZone" TO ''UTC''', current_database()); END $$;

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

CREATE SCHEMA control;

CREATE SCHEMA domains;

CREATE SCHEMA ingestor;

CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA public;

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public;

CREATE TYPE control.run_fact AS (
	key text,
	finished_at timestamp with time zone,
	status text,
	next_due_at timestamp with time zone,
	budget_hit text,
	is_attempt boolean,
	is_success boolean,
	is_change boolean,
	is_refusal boolean
);

CREATE FUNCTION control.admit(p_provider text, p_caller text, p_subject text DEFAULT NULL::text) RETURNS TABLE(admitted boolean, outcome text, token text, wait_ms integer)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'control', 'pg_temp'
    AS $$
declare
  t            timestamptz;
  k            text;
  b            control.budgets%rowtype;
  s            control.budget_state%rowtype;
  c            control.callers%rowtype;
  bw           integer;
  my_cap       integer;
  my_floor     integer;
  mine         integer := 0;
  total        integer := 0;
  reserved     integer := 0;
  burst        integer := 0;
  oldest_all   timestamptz;
  oldest_me    timestamptz;
  oldest_burst timestamptz;
  count_hit    text := null;
  count_wait   double precision := null;
  below_floor  boolean := false;
  hit          text := null;
  wait_s       double precision := null;
  bucket       timestamptz;
  sp           interval;
begin
  select p.budget_key into k from control.providers p where p.provider = p_provider;
  if k is null then
    insert into control.refusals (at, budget_key, provider, caller, subject, outcome)
    values (clock_timestamp(), p_provider, p_provider, p_caller, p_subject, 'no-budget');
    return query select false, 'no-budget'::text, null::text, null::integer;
    return;
  end if;

  select * into s from control.budget_state bs where bs.budget_key = k for update;
  if not found then
    insert into control.refusals (at, budget_key, provider, caller, subject, outcome)
    values (clock_timestamp(), k, p_provider, p_caller, p_subject, 'no-budget');
    return query select false, 'no-budget'::text, null::text, null::integer;
    return;
  end if;
  select * into b from control.budgets bb where bb.budget_key = k;
  t := clock_timestamp(); -- the instant decided at, after the lock
  bw := control.bucket_width(b.window_s, b.burst_window_s);
  if b.spacing_ms is not null then
    sp := make_interval(secs => b.spacing_ms / 1000.0);
  end if;

  select * into c from control.callers cc where cc.caller = p_caller;
  if not found then
    hit := 'no-share';
  elsif c.process <> 'mcp'
        and coalesce(nullif(current_setting('role', true), 'none'), session_user::text) = 'viafrei_mcp' then
    hit := 'no-share';
  else
    select sh.cap, sh.floor into my_cap, my_floor from control.shares sh where sh.budget_key = k and sh.caller = p_caller;
    if my_cap is not null then
      with u as (
        select g.caller,
               sum(g.admitted - g.not_sent)::integer as n,
               min(g.bucket_start) as oldest,
               coalesce(sum(g.admitted - g.not_sent) filter (
                 where b.burst_window_s is not null
                   and g.bucket_start > t - make_interval(secs => b.burst_window_s + bw)), 0)::integer as nb,
               min(g.bucket_start) filter (
                 where b.burst_window_s is not null
                   and g.bucket_start > t - make_interval(secs => b.burst_window_s + bw)) as oldest_b
          from control.usage g
         where g.budget_key = k
           and g.bucket_start > t - make_interval(secs => b.window_s + bw)
         group by g.caller
      )
      select coalesce((select sum(u.n) from u), 0)::integer,
             coalesce((select u.n from u where u.caller = p_caller), 0),
             coalesce((select sum(greatest(0, sh.floor - coalesce(u.n, 0)))
                         from control.shares sh left join u on u.caller = sh.caller
                        where sh.budget_key = k and sh.caller <> p_caller), 0)::integer,
             coalesce((select sum(u.nb) from u), 0)::integer,
             (select min(u.oldest) from u),
             (select u.oldest from u where u.caller = p_caller),
             (select min(u.oldest_b) from u)
        into total, mine, reserved, burst, oldest_all, oldest_me, oldest_burst;
      below_floor := mine < my_floor;
      if total >= b.ceiling then
        count_hit := 'ceiling';
        count_wait := extract(epoch from oldest_all + make_interval(secs => b.window_s + bw) - t);
      elsif mine >= my_cap then
        count_hit := 'share';
        count_wait := extract(epoch from oldest_me + make_interval(secs => b.window_s + bw) - t);
      elsif total + reserved >= b.ceiling then
        count_hit := 'reserved';
        count_wait := extract(epoch from oldest_all + make_interval(secs => b.window_s + bw) - t);
      elsif b.burst_max is not null and burst >= b.burst_max then
        count_hit := 'burst';
        count_wait := extract(epoch from oldest_burst + make_interval(secs => b.burst_window_s + bw) - t);
      end if;
    end if;

    if c.person and b.spacing_ms is not null and my_cap is not null and count_hit is null then
      update control.budget_state set person_wanted_at = t where budget_key = k;
    end if;
    if s.held_until is not null and s.held_until > t then
      hit := 'hold';
      wait_s := extract(epoch from s.held_until - t);
    elsif b.spacing_ms is not null and s.last_admitted_at is not null and s.last_admitted_at > t - sp then
      hit := 'spacing';
      wait_s := extract(epoch from s.last_admitted_at + sp - t);
    elsif b.spacing_ms is not null and my_cap is not null and not c.person and s.person_wanted_at is not null
          and s.person_wanted_at > t - 2 * sp then
      hit := 'yield';
      wait_s := greatest(
        extract(epoch from s.person_wanted_at + 2 * sp - t),
        coalesce(extract(epoch from s.last_admitted_at + sp - t), 0));
    elsif b.spacing_ms is not null and my_cap is not null and not below_floor
          and s.owed_by is not null and s.owed_by <> p_caller and s.owed_at > t - 2 * sp then
      hit := 'yield';
      wait_s := greatest(
        extract(epoch from s.owed_at + 2 * sp - t),
        coalesce(extract(epoch from s.last_admitted_at + sp - t), 0));
    elsif my_cap is null then
      hit := 'no-share';
    elsif count_hit is not null then
      hit := count_hit;
      wait_s := count_wait;
    end if;
    if hit = 'spacing' and c.person and my_cap is not null and below_floor and count_hit is null then
      update control.budget_state set owed_by = p_caller, owed_at = t where budget_key = k;
    end if;
  end if;

  if hit is not null then
    insert into control.refusals (at, budget_key, provider, caller, subject, outcome, wait_ms)
    values (t, k, p_provider, p_caller, p_subject, hit,
            case when wait_s is null then null else greatest(0, ceil(wait_s * 1000))::integer end);
    return query select false, hit,
                        null::text,
                        case when wait_s is null then null else greatest(0, ceil(wait_s * 1000))::integer end;
    return;
  end if;

  bucket := to_timestamp(floor(extract(epoch from t) / bw) * bw);
  insert into control.usage as g (budget_key, caller, bucket_start, admitted)
  values (k, p_caller, bucket, 1)
  on conflict (budget_key, bucket_start, caller) do update set admitted = g.admitted + 1;
  update control.budget_state
     set last_admitted_at = t, last_admitted_by = p_caller,
         owed_at = case when owed_by = p_caller then null else owed_at end,
         owed_by = case when owed_by = p_caller then null else owed_by end
   where budget_key = k;
  return query select true, 'admitted'::text, (extract(epoch from bucket))::bigint::text, 0;
end $$;

CREATE FUNCTION control.audit_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'control', 'pg_temp'
    AS $$
declare
  why text := nullif(current_setting('viafrei.reason', true), '');
  who text := coalesce(nullif(current_setting('viafrei.actor', true), ''), current_user);
  o   jsonb;
  n   jsonb;
  f   text;
  k   text;
  c   text;
begin
  if why is null then
    raise exception 'control.%: a change needs a reason (set viafrei.reason)', tg_table_name
      using errcode = 'P0001', detail = 'no-reason', hint = 'set_budget() and publish_terms() set it; by hand: set local viafrei.reason = ''…''';
  end if;
  if tg_op <> 'INSERT' then o := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then n := to_jsonb(new); end if;
  k := coalesce(n, o) ->> 'budget_key';
  c := coalesce(n, o) ->> 'caller';
  if tg_op = 'UPDATE' then
    for f in select jsonb_object_keys(n) loop
      if (o -> f) is distinct from (n -> f) then
        insert into control.changes (at, actor, reason, tbl, budget_key, caller, field, before, after)
        values (clock_timestamp(), who, why, tg_table_name, k, c, f, o ->> f, n ->> f);
      end if;
    end loop;
  else
    insert into control.changes (at, actor, reason, tbl, budget_key, caller, field, before, after)
    values (clock_timestamp(), who, why, tg_table_name, k, c, '*', o::text, n::text);
  end if;
  return null;
end $$;

CREATE FUNCTION control.bucket_width(p_window_s integer, p_burst_window_s integer) RETURNS integer
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    SET search_path TO 'control', 'pg_temp'
    AS $$ select greatest(1, least(p_window_s, coalesce(p_burst_window_s, p_window_s)) / 60) $$;

CREATE FUNCTION control.changes_append_only() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'control', 'pg_temp'
    AS $$
begin
  raise exception 'control.changes is append-only: % refused', tg_op using errcode = 'P0001', detail = 'append-only';
end $$;

CREATE FUNCTION control.check_budget_shape() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'control', 'pg_temp'
    AS $$
declare
  k     text;
  ceil_ integer;
  n     integer;
  mx    integer;
  fl    integer;
  bad   text;
  v     integer;
begin
  if tg_op = 'DELETE' then k := old.budget_key; else k := new.budget_key; end if;
  update control.budget_state set budget_key = budget_key where budget_key = k;
  if not found then
    perform 1 from control.budgets where budget_key = k for update;
  end if;
  select bb.ceiling into ceil_ from control.budgets bb where bb.budget_key = k;
  if ceil_ is null then
    return null;
  end if;
  select count(*)::integer, max(sh.cap), coalesce(sum(sh.floor), 0) into n, mx, fl from control.shares sh where sh.budget_key = k;
  if mx > ceil_ then
    raise exception 'control: a share of % has a cap of % above the key''s ceiling of %', k, mx, ceil_
      using errcode = 'P0001', detail = 'cap-over-ceiling', hint = 'lower the cap, or raise the ceiling within its licence';
  end if;
  if fl > ceil_ then
    raise exception 'control: the floors of % add up to %, above its ceiling of %', k, fl, ceil_
      using errcode = 'P0001', detail = 'floors-over-ceiling', hint = 'a floor is guaranteed; together they must fit under the ceiling';
  end if;
  if ceil_ > 0 and n >= 2 then
    select sh.caller into bad from control.shares sh where sh.budget_key = k and sh.floor < 1 and sh.cap > 0 order by sh.caller limit 1;
    if bad is not null then
      raise exception 'control: caller % of % has no floor; on a key of two or more callers each one keeps at least 1', bad, k
        using errcode = 'P0001', detail = 'no-floor', hint = 'no caller may be starved by another: give it a floor of at least 1, switch it off with a cap of 0, or pause the key with control.set_budget(key, null, ''ceiling'', 0, ...)';
    end if;
    select sh.caller, sh.cap into bad, v from control.shares sh
     where sh.budget_key = k and sh.cap > ceil_ - (fl - sh.floor) order by sh.caller limit 1;
    if bad is not null then
      raise exception 'control: caller % of % has a cap of %, above the ceiling % less the other callers'' floors %', bad, k, v, ceil_, fl - (select s2.floor from control.shares s2 where s2.budget_key = k and s2.caller = bad)
        using errcode = 'P0001', detail = 'cap-takes-floors', hint = 'no caller may hold the whole key: lower its cap, or the others'' floors first';
    end if;
  end if;
  return null;
end $$;

CREATE FUNCTION control.feed_state_after_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'control', 'public', 'pg_temp'
    AS $$
declare
  v_ledger text := case when tg_table_name = 'feed_runs' then 'feed' else 'ingest' end;
  v_recompute text[] := '{}';
  v_keys text[] := '{}';
  k text;
begin
  if tg_op = 'UPDATE' and tg_table_name = 'feed_runs' then
    v_keys := array(select o.feed_key from old_rows o union select n.feed_key from new_rows n);
  elsif tg_op = 'UPDATE' then
    v_keys := array(select o.provider from old_rows o union select n.provider from new_rows n);
  end if;
  for k in select distinct x from unnest(v_keys) x where x is not null order by x loop
    perform pg_advisory_xact_lock(hashtextextended('control.feed_state:' || v_ledger || ':' || k, 0));
  end loop;
  if tg_op = 'DELETE' and tg_table_name = 'feed_runs' then
    v_recompute := array(
      select distinct o.feed_key from old_rows o
        join control.feed_state s on s.ledger = 'feed' and s.key = o.feed_key
       where o.finished_at is not null
         and o.finished_at in (s.last_attempt_at, s.last_success_at, s.last_changed_at, s.last_refusal_at, s.refused_since));
  elsif tg_op = 'DELETE' then
    v_recompute := array(
      select distinct o.provider from old_rows o
        join control.feed_state s on s.ledger = 'ingest' and s.key = o.provider
       where o.finished_at is not null
         and o.finished_at in (s.last_attempt_at, s.last_success_at, s.last_changed_at, s.last_refusal_at, s.refused_since));
  elsif tg_op = 'UPDATE' and tg_table_name = 'feed_runs' then
    v_recompute := array(
      select distinct o.feed_key from old_rows o
        join control.feed_state s on s.ledger = 'feed' and s.key = o.feed_key
       where o.finished_at is not null
         and o.finished_at in (s.last_attempt_at, s.last_success_at, s.last_changed_at, s.last_refusal_at, s.refused_since)
         and not exists (
               select 1 from new_rows n
                where n.id = o.id and n.feed_key = o.feed_key
                  and (n.finished_at, n.status, n.next_due_at, n.budget_hit, n.items_seen, n.items_inserted, n.items_updated, n.items_closed)
                      is not distinct from
                      (o.finished_at, o.status, o.next_due_at, o.budget_hit, o.items_seen, o.items_inserted, o.items_updated, o.items_closed)));
  elsif tg_op = 'UPDATE' then
    v_recompute := array(
      select distinct o.provider from old_rows o
        join control.feed_state s on s.ledger = 'ingest' and s.key = o.provider
       where o.finished_at is not null
         and o.finished_at in (s.last_attempt_at, s.last_success_at, s.last_changed_at, s.last_refusal_at, s.refused_since)
         and not exists (
               select 1 from new_rows n
                where n.id = o.id and n.provider = o.provider
                  and (n.finished_at, n.status, n.next_due_at, n.budget_hit, n.rows)
                      is not distinct from (o.finished_at, o.status, o.next_due_at, o.budget_hit, o.rows)));
  end if;
  if tg_op = 'DELETE' or tg_op = 'UPDATE' then
    if cardinality(v_recompute) > 0 then
      perform control.recompute_feed_state(v_ledger, v_recompute);
    end if;
  end if;
  if tg_op = 'INSERT' or tg_op = 'UPDATE' then
    if tg_table_name = 'feed_runs' then
      perform control.fold_feed_state('feed', array(
        select row(n.feed_key, n.finished_at, n.status, n.next_due_at, n.budget_hit,
                   n.budget_hit is null and n.status in ('ok', 'unchanged', 'degraded', 'error'),
                   n.budget_hit is null and (n.status in ('ok', 'unchanged') or (n.status = 'degraded' and n.items_seen is not null)),
                   n.budget_hit is null and coalesce(n.items_inserted, 0) + coalesce(n.items_updated, 0) + coalesce(n.items_closed, 0) > 0,
                   n.budget_hit is not null and n.status in ('ok', 'unchanged', 'degraded', 'error'))::control.run_fact
          from new_rows n
         where n.finished_at is not null and n.status not in ('running', 'pending') and not (n.feed_key = any(v_recompute))));
    else
      perform control.fold_feed_state('ingest', array(
        select row(n.provider, n.finished_at, n.status, n.next_due_at, n.budget_hit,
                   n.budget_hit is null and n.status in ('ok', 'degraded', 'error', 'interrupted'),
                   n.budget_hit is null and n.status in ('ok', 'degraded'),
                   n.budget_hit is null and coalesce(n.rows, 0) > 0,
                   n.budget_hit is not null and n.status in ('ok', 'degraded', 'error', 'interrupted'))::control.run_fact
          from new_rows n
         where n.finished_at is not null and n.status not in ('running', 'pending') and not (n.provider = any(v_recompute))));
    end if;
  end if;
  return null;
end $$;

CREATE FUNCTION control.feed_state_after_truncate() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'control', 'public', 'pg_temp'
    AS $$
begin
  delete from control.feed_state where ledger = case when tg_table_name = 'feed_runs' then 'feed' else 'ingest' end;
  return null;
end $$;

CREATE FUNCTION control.fit_shares(p_budget_key text) RETURNS integer
    LANGUAGE plpgsql
    SET search_path TO 'control', 'pg_temp'
    AS $$
declare
  c  integer;
  n  integer;
  fl integer;
  m  integer;
  changed integer := 0;
begin
  select bb.ceiling into c from control.budgets bb where bb.budget_key = p_budget_key;
  if c is null then
    return 0;
  end if;
  select count(*)::integer into n from control.shares sh where sh.budget_key = p_budget_key and sh.cap > 0;
  if n = 0 then
    return 0;
  end if;
  if c = 0 or n = 1 then
    update control.shares sh set cap = least(sh.cap, c), floor = least(sh.floor, sh.cap, c)
     where sh.budget_key = p_budget_key and (sh.cap > c or sh.floor > least(sh.cap, c));
    get diagnostics changed = row_count;
    return changed;
  end if;
  if c < n then
    raise exception 'control.fit_shares: % has % callers switched on and a ceiling of %; each needs a floor of at least 1', p_budget_key, n, c
      using errcode = 'P0001', detail = 'ceiling-below-callers', hint = 'raise the ceiling within its licence, switch a caller off with a cap of 0, or pause the key with a ceiling of 0';
  end if;
  update control.shares sh set floor = 1 where sh.budget_key = p_budget_key and sh.floor < 1 and sh.cap > 0;
  get diagnostics m = row_count;
  changed := changed + m;
  select sum(sh.floor)::integer into fl from control.shares sh where sh.budget_key = p_budget_key;
  if fl > c then
    update control.shares sh set floor = 1 where sh.budget_key = p_budget_key and sh.floor > 1 and sh.cap > 0;
    get diagnostics m = row_count;
    changed := changed + m;
    fl := n;
  end if;
  update control.shares sh set cap = greatest(sh.floor, least(sh.cap, c - (fl - sh.floor)))
   where sh.budget_key = p_budget_key and sh.cap <> greatest(sh.floor, least(sh.cap, c - (fl - sh.floor)));
  get diagnostics m = row_count;
  return changed + m;
end $$;

CREATE FUNCTION control.fold_feed_state(p_ledger text, p_facts control.run_fact[]) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'control', 'public', 'pg_temp'
    AS $$
declare
  r record;
  s control.feed_state%rowtype;
  v_at timestamptz;
  v_due timestamptz;
  v_status text;
  v_ref_at timestamptz;
  v_ref text;
  v_old timestamptz;
  v_new timestamptz;
begin
  for r in
    select f.key,
           (array_agg(f.finished_at order by f.finished_at desc) filter (where f.is_attempt))[1] as att_at,
           (array_agg(f.next_due_at order by f.finished_at desc) filter (where f.is_attempt))[1] as att_due,
           (array_agg(f.status order by f.finished_at desc) filter (where f.is_attempt))[1] as att_status,
           max(f.finished_at) filter (where f.is_success) as suc_at,
           max(f.finished_at) filter (where f.is_change) as chg_at,
           (array_agg(f.finished_at order by f.finished_at desc) filter (where f.is_refusal))[1] as ref_at,
           (array_agg(f.budget_hit order by f.finished_at desc) filter (where f.is_refusal))[1] as ref_hit,
           array_agg(f.finished_at) filter (where f.is_refusal) as ref_all
      from unnest(p_facts) f
     where f.key is not null and f.finished_at is not null
       and (f.is_attempt or f.is_success or f.is_change or f.is_refusal)
     group by f.key
     order by f.key
  loop
    perform pg_advisory_xact_lock(hashtextextended('control.feed_state:' || p_ledger || ':' || r.key, 0));
    s := null;
    select * into s from control.feed_state where ledger = p_ledger and key = r.key;
    if r.att_at is not null and (s.last_attempt_at is null or r.att_at > s.last_attempt_at) then
      v_at := r.att_at; v_due := r.att_due; v_status := r.att_status;
    else
      v_at := s.last_attempt_at; v_due := s.next_due_at; v_status := s.last_attempt_status;
    end if;
    if r.ref_at is not null and (s.last_refusal_at is null or r.ref_at > s.last_refusal_at) then
      v_ref_at := r.ref_at; v_ref := r.ref_hit;
    else
      v_ref_at := s.last_refusal_at; v_ref := s.last_refusal;
    end if;
    if s.refused_since is null then
      v_old := null;
    elsif v_at is null or s.refused_since > v_at then
      v_old := s.refused_since;
    elsif s.last_refusal_at is null or s.last_refusal_at <= v_at then
      v_old := null;
    elsif p_ledger = 'feed' then
      select min(q.finished_at) into v_old from feed_runs q
       where q.feed_key = r.key and q.finished_at is not null and q.budget_hit is not null and q.finished_at > v_at
         and q.status in ('ok', 'unchanged', 'degraded', 'error');
    else
      select min(q.finished_at) into v_old from ingest_runs q
       where q.provider = r.key and q.finished_at is not null and q.budget_hit is not null and q.finished_at > v_at
         and q.status in ('ok', 'degraded', 'error', 'interrupted');
    end if;
    select min(x) into v_new from unnest(r.ref_all) x where v_at is null or x > v_at;
    insert into control.feed_state (ledger, key, budget_key, cadence_s, next_due_at, last_attempt_at, last_attempt_status,
                                    last_success_at, last_changed_at, last_refusal_at, last_refusal, refused_since, updated_at)
    values (p_ledger, r.key,
            case when p_ledger = 'feed'
                 then (select p.budget_key from control.providers p
                        where p.provider = coalesce((select c.provider from feed_catalog c where c.feed_key = r.key), r.key))
                 else (select p.budget_key from control.providers p where p.provider = split_part(r.key, ':', 1)) end,
            case when p_ledger = 'feed' then (select c.cadence_s from feed_catalog c where c.feed_key = r.key) end,
            v_due, v_at, v_status,
            greatest(s.last_success_at, r.suc_at), greatest(s.last_changed_at, r.chg_at),
            v_ref_at, v_ref, least(v_old, v_new), clock_timestamp())
    on conflict (ledger, key) do update set
      budget_key = excluded.budget_key, cadence_s = excluded.cadence_s, next_due_at = excluded.next_due_at,
      last_attempt_at = excluded.last_attempt_at, last_attempt_status = excluded.last_attempt_status,
      last_success_at = excluded.last_success_at, last_changed_at = excluded.last_changed_at,
      last_refusal_at = excluded.last_refusal_at, last_refusal = excluded.last_refusal,
      refused_since = excluded.refused_since, updated_at = excluded.updated_at;
  end loop;
end $$;

CREATE FUNCTION control.hold(p_provider text, p_reason text) RETURNS timestamp with time zone
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'control', 'pg_temp'
    AS $$
declare
  k  text;
  hs integer;
  u  timestamptz;
begin
  if p_reason is null or p_reason not in ('429', '5xx', 'owner') then
    raise exception 'control.hold: reason % is none of 429, 5xx, owner', p_reason using errcode = 'P0001', detail = 'bad-reason';
  end if;
  select p.budget_key, b.hold_s into k, hs
    from control.providers p join control.budgets b using (budget_key)
   where p.provider = p_provider;
  if k is null or hs = 0 then
    return null;
  end if;
  update control.budget_state
     set held_until = greatest(coalesce(held_until, clock_timestamp()), clock_timestamp() + make_interval(secs => hs)),
         held_reason = p_reason
   where budget_key = k
  returning held_until into u;
  return u;
end $$;

CREATE FUNCTION control.publish_terms(p jsonb) RETURNS TABLE(callers integer, budgets integer, providers integer, shares integer)
    LANGUAGE plpgsql
    SET search_path TO 'control', 'pg_temp'
    AS $$
declare
  n_c integer;
  n_b integer;
  n_p integer;
  n_s integer;
begin
  if p is null or jsonb_typeof(p -> 'budgets') is distinct from 'array' or jsonb_array_length(p -> 'budgets') = 0
     or jsonb_typeof(p -> 'providers') is distinct from 'array' or jsonb_array_length(p -> 'providers') = 0
     or jsonb_typeof(p -> 'callers') is distinct from 'array' or jsonb_array_length(p -> 'callers') = 0 then
    raise exception 'control.publish_terms: an empty or malformed declaration' using errcode = 'P0001', detail = 'empty-declaration';
  end if;
  perform set_config('viafrei.actor', 'publish_terms', true);
  perform set_config('viafrei.reason', 'published from the provider terms register', true);

  insert into control.callers as t (caller, process, person, purpose)
  select x ->> 'caller', x ->> 'process', (x ->> 'person')::boolean, x ->> 'purpose'
    from jsonb_array_elements(p -> 'callers') x
  on conflict (caller) do update set process = excluded.process, person = excluded.person, purpose = excluded.purpose
   where (t.process, t.person, t.purpose) is distinct from (excluded.process, excluded.person, excluded.purpose);
  get diagnostics n_c = row_count;

  insert into control.budgets as t (budget_key, window_s, licence_max, licence_source, ceiling,
                                    burst_window_s, burst_licence_max, burst_max,
                                    spacing_licence_ms, spacing_ms, hold_s, reserve_pct)
  select x ->> 'budget_key', (x ->> 'window_s')::integer, (x ->> 'licence_max')::integer, x ->> 'licence_source',
         (x ->> 'licence_max')::integer,
         (x ->> 'burst_window_s')::integer, (x ->> 'burst_licence_max')::integer, (x ->> 'burst_licence_max')::integer,
         (x ->> 'spacing_licence_ms')::integer, (x ->> 'spacing_licence_ms')::integer,
         coalesce((x ->> 'hold_s')::integer, 0), coalesce((x ->> 'reserve_pct')::numeric, 0)
    from jsonb_array_elements(p -> 'budgets') x
  on conflict (budget_key) do update set
         window_s           = excluded.window_s,
         licence_max        = excluded.licence_max,
         licence_source     = excluded.licence_source,
         ceiling            = least(t.ceiling, excluded.licence_max),
         burst_window_s     = excluded.burst_window_s,
         burst_licence_max  = excluded.burst_licence_max,
         burst_max          = case when excluded.burst_licence_max is null then null
                                   else least(coalesce(t.burst_max, excluded.burst_licence_max), excluded.burst_licence_max) end,
         spacing_licence_ms = excluded.spacing_licence_ms,
         spacing_ms         = case when excluded.spacing_licence_ms is null then null
                                   else greatest(coalesce(t.spacing_ms, excluded.spacing_licence_ms), excluded.spacing_licence_ms) end,
         hold_s             = excluded.hold_s
   where (t.window_s, t.licence_max, t.licence_source, t.burst_window_s, t.burst_licence_max, t.spacing_licence_ms, t.hold_s)
         is distinct from
         (excluded.window_s, excluded.licence_max, excluded.licence_source, excluded.burst_window_s, excluded.burst_licence_max, excluded.spacing_licence_ms, excluded.hold_s);
  get diagnostics n_b = row_count;

  insert into control.budget_state (budget_key)
  select x ->> 'budget_key' from jsonb_array_elements(p -> 'budgets') x
  on conflict (budget_key) do nothing;

  insert into control.providers as t (provider, budget_key, min_interval_ms, max_concurrent)
  select x ->> 'provider', x ->> 'budget_key', (x ->> 'min_interval_ms')::integer, (x ->> 'max_concurrent')::smallint
    from jsonb_array_elements(p -> 'providers') x
  on conflict (provider) do update set budget_key = excluded.budget_key, min_interval_ms = excluded.min_interval_ms, max_concurrent = excluded.max_concurrent
   where (t.budget_key, t.min_interval_ms, t.max_concurrent) is distinct from (excluded.budget_key, excluded.min_interval_ms, excluded.max_concurrent);
  get diagnostics n_p = row_count;

  insert into control.shares (budget_key, caller, floor, cap)
  select x ->> 'budget_key', x ->> 'caller', (x ->> 'floor')::integer, (x ->> 'cap')::integer
    from jsonb_array_elements(coalesce(p -> 'shares', '[]'::jsonb)) x
  on conflict (budget_key, caller) do nothing;
  get diagnostics n_s = row_count;

  perform control.fit_shares(b.budget_key) from control.budgets b order by b.budget_key;

  return query select n_c, n_b, n_p, n_s;
end $$;

CREATE FUNCTION control.recompute_feed_state(p_ledger text, p_keys text[]) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'control', 'public', 'pg_temp'
    AS $$
declare
  k text;
begin
  for k in select distinct x from unnest(p_keys) x where x is not null order by x loop
    perform pg_advisory_xact_lock(hashtextextended('control.feed_state:' || p_ledger || ':' || k, 0));
  end loop;
  delete from control.feed_state where ledger = p_ledger and key = any(p_keys);
  if p_ledger = 'feed' then
    insert into control.feed_state (ledger, key, budget_key, cadence_s, next_due_at, last_attempt_at, last_attempt_status,
                                    last_success_at, last_changed_at, last_refusal_at, last_refusal, refused_since, updated_at)
    select 'feed', k.key,
           (select p.budget_key from control.providers p where p.provider = coalesce(c.provider, k.key)),
           c.cadence_s,
           a.next_due_at, a.finished_at, a.status,
           (select r.finished_at from feed_runs r
             where r.feed_key = k.key and r.finished_at is not null and r.budget_hit is null
               and (r.status in ('ok', 'unchanged') or (r.status = 'degraded' and r.items_seen is not null))
             order by r.finished_at desc limit 1),
           (select r.finished_at from feed_runs r
             where r.feed_key = k.key and r.finished_at is not null and r.budget_hit is null
               and coalesce(r.items_inserted, 0) + coalesce(r.items_updated, 0) + coalesce(r.items_closed, 0) > 0
             order by r.finished_at desc limit 1),
           h.finished_at, h.budget_hit,
           (select min(r.finished_at) from feed_runs r
             where r.feed_key = k.key and r.finished_at is not null and r.budget_hit is not null
               and r.status in ('ok', 'unchanged', 'degraded', 'error')
               and (a.finished_at is null or r.finished_at > a.finished_at)),
           clock_timestamp()
      from unnest(p_keys) k(key)
      left join feed_catalog c on c.feed_key = k.key
      left join lateral (
        select r.next_due_at, r.finished_at, r.status from feed_runs r
         where r.feed_key = k.key and r.finished_at is not null and r.budget_hit is null
           and r.status in ('ok', 'unchanged', 'degraded', 'error')
         order by r.finished_at desc limit 1) a on true
      left join lateral (
        select r.finished_at, r.budget_hit from feed_runs r
         where r.feed_key = k.key and r.finished_at is not null and r.budget_hit is not null
           and r.status in ('ok', 'unchanged', 'degraded', 'error')
         order by r.finished_at desc limit 1) h on true
     where a.finished_at is not null or h.finished_at is not null;
  else
    insert into control.feed_state (ledger, key, budget_key, next_due_at, last_attempt_at, last_attempt_status,
                                    last_success_at, last_changed_at, last_refusal_at, last_refusal, refused_since, updated_at)
    select 'ingest', k.key,
           (select p.budget_key from control.providers p where p.provider = split_part(k.key, ':', 1)),
           a.next_due_at, a.finished_at, a.status,
           (select r.finished_at from ingest_runs r
             where r.provider = k.key and r.finished_at is not null and r.budget_hit is null and r.status in ('ok', 'degraded')
             order by r.finished_at desc limit 1),
           (select r.finished_at from ingest_runs r
             where r.provider = k.key and r.finished_at is not null and r.budget_hit is null and coalesce(r.rows, 0) > 0
             order by r.finished_at desc limit 1),
           h.finished_at, h.budget_hit,
           (select min(r.finished_at) from ingest_runs r
             where r.provider = k.key and r.finished_at is not null and r.budget_hit is not null
               and r.status in ('ok', 'degraded', 'error', 'interrupted')
               and (a.finished_at is null or r.finished_at > a.finished_at)),
           clock_timestamp()
      from unnest(p_keys) k(key)
      left join lateral (
        select r.next_due_at, r.finished_at, r.status from ingest_runs r
         where r.provider = k.key and r.finished_at is not null and r.budget_hit is null
           and r.status in ('ok', 'degraded', 'error', 'interrupted')
         order by r.finished_at desc limit 1) a on true
      left join lateral (
        select r.finished_at, r.budget_hit from ingest_runs r
         where r.provider = k.key and r.finished_at is not null and r.budget_hit is not null
           and r.status in ('ok', 'degraded', 'error', 'interrupted')
         order by r.finished_at desc limit 1) h on true
     where a.finished_at is not null or h.finished_at is not null;
  end if;
end $$;

CREATE FUNCTION control.release(p_provider text, p_caller text, p_token text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'control', 'pg_temp'
    AS $_$
declare
  k text;
begin
  select p.budget_key into k from control.providers p where p.provider = p_provider;
  if k is null or p_token is null or p_token !~ '^[0-9]{1,12}$' then
    return;
  end if;
  perform 1 from control.budget_state where budget_key = k for update;
  update control.usage set not_sent = not_sent + 1
   where budget_key = k and caller = p_caller and bucket_start = to_timestamp(p_token::bigint) and not_sent < admitted;
end $_$;

CREATE FUNCTION control.rollup_refresh(p_from timestamp with time zone DEFAULT (now() - '02:00:00'::interval)) RETURNS TABLE(hourly_rows integer, usage_deleted integer, refusals_deleted integer, hourly_deleted integer)
    LANGUAGE plpgsql
    SET search_path TO 'control', 'pg_temp'
    AS $$
declare
  h0    timestamptz := date_trunc('hour', p_from);
  n_h   integer;
  n_u   integer;
  n_r   integer;
  n_old integer;
begin
  insert into control.usage_hourly as t (
    hour, budget_key, caller, admitted, not_sent,
    refused_ceiling, refused_share, refused_reserved, refused_burst, refused_spacing, refused_yield, refused_hold, refused_unconfigured,
    first_refused_at, last_refused_at, ceiling_at, cap_at, floor_at, computed_at)
  select x.hour, x.budget_key, x.caller,
         sum(x.admitted)::integer, sum(x.not_sent)::integer,
         count(*) filter (where x.outcome = 'ceiling')::integer,
         count(*) filter (where x.outcome = 'share')::integer,
         count(*) filter (where x.outcome = 'reserved')::integer,
         count(*) filter (where x.outcome = 'burst')::integer,
         count(*) filter (where x.outcome = 'spacing')::integer,
         count(*) filter (where x.outcome = 'yield')::integer,
         count(*) filter (where x.outcome = 'hold')::integer,
         count(*) filter (where x.outcome in ('no-budget', 'no-share'))::integer,
         min(x.refused_at), max(x.refused_at),
         max(b.ceiling), max(sh.cap), max(sh.floor), clock_timestamp()
    from (
      select date_trunc('hour', g.bucket_start) as hour, g.budget_key, g.caller,
             g.admitted, g.not_sent, null::text as outcome, null::timestamptz as refused_at
        from control.usage g
       where g.bucket_start >= h0
      union all
      select date_trunc('hour', r.at), r.budget_key, r.caller, 0, 0, r.outcome, r.at
        from control.refusals r
       where r.at >= h0
    ) x
    left join control.budgets b on b.budget_key = x.budget_key
    left join control.shares sh on sh.budget_key = x.budget_key and sh.caller = x.caller
   group by x.hour, x.budget_key, x.caller
  on conflict (hour, budget_key, caller) do update set
         admitted = excluded.admitted, not_sent = excluded.not_sent,
         refused_ceiling = excluded.refused_ceiling, refused_share = excluded.refused_share,
         refused_reserved = excluded.refused_reserved, refused_burst = excluded.refused_burst,
         refused_spacing = excluded.refused_spacing, refused_yield = excluded.refused_yield,
         refused_hold = excluded.refused_hold, refused_unconfigured = excluded.refused_unconfigured,
         first_refused_at = excluded.first_refused_at, last_refused_at = excluded.last_refused_at,
         ceiling_at = excluded.ceiling_at, cap_at = excluded.cap_at, floor_at = excluded.floor_at,
         computed_at = excluded.computed_at;
  get diagnostics n_h = row_count;

  delete from control.usage where bucket_start < now() - interval '48 hours';
  get diagnostics n_u = row_count;
  delete from control.refusals where at < now() - interval '14 days';
  get diagnostics n_r = row_count;
  delete from control.usage_hourly where hour < now() - interval '90 days';
  get diagnostics n_old = row_count;
  return query select n_h, n_u, n_r, n_old;
end $$;

CREATE FUNCTION control.set_budget(p_budget_key text, p_caller text, p_field text, p_value numeric, p_actor text, p_reason text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'control', 'pg_temp'
    AS $_$
declare
  b  control.budgets%rowtype;
  sh control.shares%rowtype;
  v  integer;
begin
  if p_actor is null or p_actor !~ '^[a-z][a-z0-9_-]{0,31}$' then
    raise exception 'control.set_budget: actor % is not a name', p_actor using errcode = 'P0001', detail = 'bad-actor';
  end if;
  if p_reason is null or length(p_reason) not between 3 and 200 then
    raise exception 'control.set_budget: a change needs a reason of 3 to 200 characters' using errcode = 'P0001', detail = 'no-reason';
  end if;
  if p_value is null or p_value < 0 then
    raise exception 'control.set_budget: % must be a number of at least 0', p_field using errcode = 'P0001', detail = 'negative';
  end if;
  perform set_config('viafrei.actor', p_actor, true);
  perform set_config('viafrei.reason', p_reason, true);
  select * into b from control.budgets where budget_key = p_budget_key;
  if not found then
    raise exception 'control.set_budget: no budget named %', p_budget_key using errcode = 'P0001', detail = 'unknown-budget';
  end if;
  if p_field is distinct from 'reserve_pct' then
    if p_value <> trunc(p_value) or p_value > 2000000000 then
      raise exception 'control.set_budget: % must be a whole number', p_field using errcode = 'P0001', detail = 'not-integer';
    end if;
    v := p_value::integer;
  end if;
  if p_caller is null then
    if p_field = 'ceiling' then
      if v > b.licence_max then
        raise exception 'control.set_budget: a ceiling of % is above the licence of % for %', v, b.licence_max, p_budget_key
          using errcode = 'P0001', detail = 'above-licence', hint = 'no setting may exceed the provider''s terms';
      end if;
      update control.budgets set ceiling = v where budget_key = p_budget_key;
      perform control.fit_shares(p_budget_key);
    elsif p_field = 'burst_max' then
      if b.burst_licence_max is null then
        raise exception 'control.set_budget: % has no burst', p_budget_key using errcode = 'P0001', detail = 'no-shape';
      end if;
      if v > b.burst_licence_max then
        raise exception 'control.set_budget: a burst of % is above the licence of % for %', v, b.burst_licence_max, p_budget_key
          using errcode = 'P0001', detail = 'above-licence';
      end if;
      update control.budgets set burst_max = v where budget_key = p_budget_key;
    elsif p_field = 'spacing_ms' then
      if b.spacing_licence_ms is null then
        raise exception 'control.set_budget: % has no spacing', p_budget_key using errcode = 'P0001', detail = 'no-shape';
      end if;
      if v < b.spacing_licence_ms then
        raise exception 'control.set_budget: a spacing of % ms is faster than the licence''s % ms for %', v, b.spacing_licence_ms, p_budget_key
          using errcode = 'P0001', detail = 'above-licence';
      end if;
      update control.budgets set spacing_ms = v where budget_key = p_budget_key;
    elsif p_field = 'reserve_pct' then
      update control.budgets set reserve_pct = p_value where budget_key = p_budget_key;
    else
      raise exception 'control.set_budget: % is not a tunable of a budget', p_field using errcode = 'P0001', detail = 'unknown-field';
    end if;
  else
    select * into sh from control.shares where budget_key = p_budget_key and caller = p_caller for update;
    if not found then
      raise exception 'control.set_budget: % has no share for caller %', p_budget_key, p_caller using errcode = 'P0001', detail = 'unknown-caller';
    end if;
    if p_field = 'cap' then
      if v < sh.floor and v > 0 then
        raise exception 'control.set_budget: the cap % of caller % is below its floor %', v, p_caller, sh.floor
          using errcode = 'P0001', detail = 'below-floor', hint = 'lower the floor first';
      end if;
      update control.shares
         set cap = v,
             floor = case when v = 0 then 0 when floor < 1 then 1 else floor end
       where budget_key = p_budget_key and caller = p_caller;
    elsif p_field = 'floor' then
      if v > sh.cap then
        raise exception 'control.set_budget: the floor % of caller % is above its cap %', v, p_caller, sh.cap
          using errcode = 'P0001', detail = 'above-cap', hint = 'raise the cap first';
      end if;
      update control.shares set floor = v where budget_key = p_budget_key and caller = p_caller;
    else
      raise exception 'control.set_budget: % is not a tunable of a share', p_field using errcode = 'P0001', detail = 'unknown-field';
    end if;
  end if;
end $_$;

CREATE FUNCTION control.want(p_provider text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'control', 'pg_temp'
    AS $$
declare
  k text;
begin
  select p.budget_key into k
    from control.providers p join control.budgets b using (budget_key)
   where p.provider = p_provider and b.spacing_ms is not null;
  if k is null then
    return;
  end if;
  update control.budget_state set person_wanted_at = clock_timestamp() where budget_key = k;
end $$;

CREATE FUNCTION ingestor.project_run(p_run_id bigint) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
declare r ingestor.runs; s ingestor.source_state; v text;
begin
  select * into r from ingestor.runs where id = p_run_id for update;
  if r.id is null then raise exception 'ingestor.project_run: no run %', p_run_id; end if;
  if r.status = 'running' then raise exception 'ingestor.project_run: run % is still running', p_run_id; end if;
  if r.source_id is distinct from current_setting('viafrei.source_id', true) then
    raise exception 'ingestor.project_run: run % belongs to %, not to this transaction''s source', p_run_id, r.source_id
      using errcode = '42501';
  end if;
  if not exists (select 1 from public.feed_catalog c where c.feed_key = r.source_id and c.published_by = 'ingestor') then
    raise exception 'ingestor.project_run: feed_key % is not a feed the ingestor registered', r.source_id
      using errcode = '42501';
  end if;
  if r.projected_at is not null then raise exception 'ingestor.project_run: run % is already projected', p_run_id; end if;
  update ingestor.runs set projected_at = clock_timestamp() where id = p_run_id;
  select * into s from ingestor.source_state where source_id = r.source_id;
  select registered_by into v from ingestor.sources where id = r.source_id;
  insert into public.feed_runs (feed_key, started_at, finished_at, status, http_status, bytes, etag, last_modified, raw_path,
                                items_seen, items_changed, items_inserted, items_updated, items_closed, error, duration_ms,
                                note, worker_version, next_due_at)
  values (r.source_id, r.started_at, r.finished_at,
          case r.status when 'partial' then 'degraded' when 'limited' then 'held' else r.status end,
          r.http_status, r.bytes, s.etag, s.last_modified, r.raw_path,
          r.fetched, coalesce(r.inserted, 0) + coalesce(r.updated, 0) + coalesce(r.closed, 0), r.inserted, r.updated, r.closed,
          case when r.error_class is null then null else r.error_class || ': ' || left(r.error_message, 400) end,
          r.duration_ms, 'ingest unit ' || coalesce(r.unit, '?') || ' instance ' || coalesce(r.pod, '?'),
          v, s.next_due_at);
end $$;

CREATE FUNCTION ingestor.register_feed(p_feed_key text, p_display_name text, p_provider text, p_licence_id text, p_licence_label text, p_attribution text, p_cadence_s integer, p_min_interval_s integer, p_enabled boolean, p_registry_version text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
begin
  if not exists (select 1 from ingestor.sources s where s.id = p_feed_key) then
    raise exception 'ingestor.register_feed: % is not a registered ingestor source', p_feed_key;
  end if;
  if exists (select 1 from public.feed_catalog c where c.feed_key = p_feed_key and c.published_by is distinct from 'ingestor') then
    raise exception 'ingestor.register_feed: feed_key % belongs to another publisher', p_feed_key;
  end if;
  insert into public.feed_catalog as c (feed_key, provider, display_name, licence_id, licence_label, attribution,
                                        format, cadence_s, min_interval_s, enabled, registry_version, published_by, updated_at, closed_at)
  values (p_feed_key, p_provider, p_display_name, p_licence_id, p_licence_label, p_attribution,
          'ingestor', p_cadence_s, p_min_interval_s, p_enabled, p_registry_version, 'ingestor', clock_timestamp(), null)
  on conflict (feed_key) do update
     set provider = excluded.provider, display_name = excluded.display_name, licence_id = excluded.licence_id,
         licence_label = excluded.licence_label, attribution = excluded.attribution, cadence_s = excluded.cadence_s,
         min_interval_s = excluded.min_interval_s, enabled = excluded.enabled, registry_version = excluded.registry_version,
         updated_at = clock_timestamp(), closed_at = null
   where c.published_by = 'ingestor';
end $$;

CREATE FUNCTION ingestor.taken_feed_keys(p_ids text[]) RETURNS SETOF text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
  select c.feed_key from public.feed_catalog c
   where c.feed_key = any(p_ids) and c.published_by is distinct from 'ingestor'
   order by 1
$$;

CREATE FUNCTION public.autobahn_event_raw(p_ext_id text, p_observed_at timestamp with time zone) RETURNS jsonb
    LANGUAGE sql STABLE PARALLEL SAFE
    AS $$
  select autobahn_raw_resolve(e.raw, e.raw_hash, e.ext_id, e.observed_at)
    from autobahn_events e
   where e.ext_id = p_ext_id and e.observed_at = p_observed_at
   order by (e.raw is null), e.kind
   limit 1
$$;

CREATE FUNCTION public.autobahn_event_texts_backfill(since timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS bigint
    LANGUAGE plpgsql
    AS $$
declare
  n bigint;
begin
  insert into autobahn_event_texts as t (road, title, subtitle, first_seen_at, last_seen_at, geom)
  with folded as (
    select e.road,
           coalesce(e.title, '')    as title,
           coalesce(e.subtitle, '') as subtitle,
           min(e.observed_at)       as first_seen_at,
           max(e.observed_at)       as last_seen_at
      from autobahn_events e
     where since is null or e.observed_at >= since
     group by 1, 2, 3
  )
  select f.road, f.title, f.subtitle, f.first_seen_at, f.last_seen_at,
         (select w.geom
            from autobahn_events w
           where w.road = f.road
             and w.observed_at = f.last_seen_at
             and coalesce(w.title, '') = f.title
             and coalesce(w.subtitle, '') = f.subtitle
           order by (w.geom is null), w.geom::text
           limit 1)
    from folded f
  on conflict (road, title, subtitle) do update
     set first_seen_at = least(t.first_seen_at, excluded.first_seen_at),
         last_seen_at  = greatest(t.last_seen_at, excluded.last_seen_at),
         geom          = case
                           when excluded.last_seen_at > t.last_seen_at then excluded.geom
                           when excluded.last_seen_at = t.last_seen_at
                                and (excluded.geom is null, excluded.geom::text)
                                  < (t.geom is null, t.geom::text)        then excluded.geom
                           else t.geom
                         end;
  get diagnostics n = row_count;
  return n;
end
$$;

CREATE FUNCTION public.autobahn_jam_rollup_refresh(p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS integer
    LANGUAGE plpgsql
    SET jit TO 'off'
    SET max_parallel_workers_per_gather TO '0'
    AS $$
declare
  v_to   timestamptz := coalesce(p_to, now());
  v_from timestamptz := p_from;
  lo     timestamptz;
  hi     timestamptz;
  n      integer;
begin
  if v_from is null then
    select greatest(v_to - interval '1 day', least(v_to - interval '1 hour', max(h.hour_start)))
      into v_from from autobahn_jam_hours h;
  end if;
  if v_to <= v_from then
    raise exception 'autobahn_jam_rollup_refresh: the window must be non-empty (from % to %)', v_from, v_to;
  end if;
  if v_to - v_from > interval '2 days' then
    raise exception 'autobahn_jam_rollup_refresh: a window of % is longer than 2 days — backfill in chunks of a day', v_to - v_from;
  end if;
  lo := date_trunc('hour', v_from, 'UTC');
  hi := date_trunc('hour', v_to - interval '1 microsecond', 'UTC') + interval '1 hour';

  with d as materialized (
    select distinct
           date_trunc('hour', e.observed_at, 'UTC') as hour_start,
           e.road,
           (e.kind = 'warning' and e.abnormal_traffic_type is not null and e.title is not null) as jam,
           case when e.kind = 'warning' and e.abnormal_traffic_type is not null and e.title is not null then e.title end as title,
           case when e.kind = 'warning' and e.abnormal_traffic_type is not null and e.title is not null then e.subtitle end as subtitle
    from autobahn_events e
    where e.observed_at >= lo and e.observed_at < hi
  )
  insert into autobahn_jam_hours as h (hour_start, road, jam_titles, jam_subtitles)
  select d.hour_start, d.road,
         coalesce(array_agg(d.title order by d.title, d.subtitle) filter (where d.jam), '{}'),
         coalesce(array_agg(d.subtitle order by d.title, d.subtitle) filter (where d.jam), '{}')
  from d
  group by d.hour_start, d.road
  on conflict (hour_start, road) do update
    set jam_titles = excluded.jam_titles, jam_subtitles = excluded.jam_subtitles
    where (h.jam_titles, h.jam_subtitles) is distinct from (excluded.jam_titles, excluded.jam_subtitles);
  get diagnostics n = row_count;
  return n;
end;
$$;

CREATE FUNCTION public.autobahn_raw_resolve(p_raw jsonb, p_raw_hash bytea, p_ext_id text, p_observed_at timestamp with time zone) RETURNS jsonb
    LANGUAGE sql STABLE PARALLEL SAFE
    AS $$
  select case
           when p_raw is not null then p_raw
           when p_raw_hash is null then null
           else (
             select e.raw
               from autobahn_events e
              where e.ext_id = p_ext_id
                and e.observed_at >= date_trunc('day', p_observed_at at time zone 'UTC') at time zone 'UTC'
                and e.observed_at < p_observed_at
                and e.raw is not null
                and e.raw_hash = p_raw_hash
              order by e.observed_at desc
              limit 1
           )
         end
$$;

CREATE FUNCTION public.autobahn_validity_date(d text, mo text, y text) RETURNS date
    LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
    AS $_$
declare
  yi int;
  mi int;
  di int;
begin
  if d !~ '^[0-9]{1,2}$' or mo !~ '^[0-9]{1,2}$' or y !~ '^([0-9]{2}|[0-9]{4})$' then return null; end if;
  yi := case when length(y) = 2 then 2000 + y::int else y::int end;
  mi := mo::int;
  di := d::int;
  if yi < 1 or mi < 1 or mi > 12 or di < 1 then return null; end if;
  if di > extract(day from make_date(yi, mi, 1) + interval '1 month' - interval '1 day')::int then return null; end if;
  return make_date(yi, mi, di);
end;
$_$;

CREATE FUNCTION public.autobahn_validity_overlaps(description jsonb, from_at timestamp with time zone, to_at timestamp with time zone) RETURNS boolean
    LANGUAGE plpgsql STABLE PARALLEL SAFE
    AS $_$
declare
  l text;
  m text[];
  section text := '';
  except_days date[] := '{}';
  stated boolean := false;
  from_day date := (from_at at time zone 'Europe/Berlin')::date;
  to_day date := (to_at at time zone 'Europe/Berlin')::date;
  d1 date;
  d2 date;
  dd date;
  t1 time;
  t2 time;
  w_start timestamptz;
  w_end timestamptz;
  dows int[];
  word text;
begin
  if description is null or jsonb_typeof(description) <> 'array' or description::text not like '%Zeiträumen gültig%' then
    return null;
  end if;

  for l in select btrim(x) from jsonb_array_elements_text(description) with ordinality as t(x, n) where n <= 60 order by n loop
    if l ~* 'gilt nicht an folgenden Tagen' then section := 'except'; continue; end if;
    if l ~* 'Zeiträumen gültig' or l = '' then section := ''; continue; end if;
    if section = 'except' then
      for m in select regexp_matches(l, '([0-9]{1,2})\.([0-9]{1,2})\.([0-9]{2,4})', 'g') loop
        dd := autobahn_validity_date(m[1], m[2], m[3]);
        if dd is not null then except_days := except_days || dd; end if;
      end loop;
    end if;
  end loop;

  section := '';
  for l in select btrim(x) from jsonb_array_elements_text(description) with ordinality as t(x, n) where n <= 60 order by n loop
    if l ~* 'Zeiträumen gültig' then section := 'list'; continue; end if;
    if l = '' or l ~* 'gilt nicht an folgenden Tagen' then section := ''; continue; end if;
    if section <> 'list' then continue; end if;
      m := regexp_match(l, '^Jeden (.+?) zwischen dem ([0-9]{1,2})\.([0-9]{1,2})\.([0-9]{2,4}) und dem ([0-9]{1,2})\.([0-9]{1,2})\.([0-9]{2,4}) von ([0-9]{1,2}):([0-9]{2}) bis ([0-9]{1,2}):([0-9]{2})');
      if m is not null then
        dows := '{}';
        if m[1] ~* '^Tag$' then
          dows := array[1, 2, 3, 4, 5, 6, 7];
        else
          foreach word in array regexp_split_to_array(m[1], '\s*(,|und)\s*') loop
            dows := dows || case lower(btrim(word))
              when 'montag' then 1 when 'dienstag' then 2 when 'mittwoch' then 3 when 'donnerstag' then 4
              when 'freitag' then 5 when 'samstag' then 6 when 'sonntag' then 7 end;
          end loop;
          dows := array_remove(dows, null);
        end if;
        if cardinality(dows) = 0 then continue; end if;
        d1 := autobahn_validity_date(m[2], m[3], m[4]);
        d2 := autobahn_validity_date(m[5], m[6], m[7]);
        t1 := autobahn_validity_time(m[8], m[9]);
        t2 := autobahn_validity_time(m[10], m[11]);
        if d1 is null or d2 is null or t1 is null or t2 is null then continue; end if;
        stated := true;
        dd := greatest(d1, from_day - 1);
        while dd <= least(d2, to_day) loop
          if extract(isodow from dd)::int = any(dows) and not (dd = any(except_days)) then
            w_start := (dd + t1) at time zone 'Europe/Berlin';
            w_end := (case when t2 <= t1 then dd + 1 else dd end + t2) at time zone 'Europe/Berlin';
            if w_start <= to_at and w_end > from_at then return true; end if;
          end if;
          dd := dd + 1;
        end loop;
        continue;
      end if;
      m := regexp_match(l, '^([0-9]{1,2})\.([0-9]{1,2})\.([0-9]{2,4}),? (?:um )?([0-9]{1,2}):([0-9]{2})(?: Uhr)? bis (?:zum )?([0-9]{1,2})\.([0-9]{1,2})\.([0-9]{2,4}),? (?:um )?([0-9]{1,2}):([0-9]{2})');
      if m is not null then
        d1 := autobahn_validity_date(m[1], m[2], m[3]);
        t1 := autobahn_validity_time(m[4], m[5]);
        d2 := autobahn_validity_date(m[6], m[7], m[8]);
        t2 := autobahn_validity_time(m[9], m[10]);
        if d1 is null or d2 is null or t1 is null or t2 is null then continue; end if;
        w_start := (d1 + t1) at time zone 'Europe/Berlin';
        w_end := (d2 + t2) at time zone 'Europe/Berlin';
        stated := true;
        if w_start <= to_at and w_end > from_at then return true; end if;
        continue;
      end if;
      m := regexp_match(l, '^([0-9]{1,2})\.([0-9]{1,2})\.([0-9]{2,4}),? von ([0-9]{1,2}):([0-9]{2}) bis ([0-9]{1,2}):([0-9]{2})');
      if m is not null then
        dd := autobahn_validity_date(m[1], m[2], m[3]);
        t1 := autobahn_validity_time(m[4], m[5]);
        t2 := autobahn_validity_time(m[6], m[7]);
        if dd is null or t1 is null or t2 is null then continue; end if;
        stated := true;
        if not (dd = any(except_days)) then
          w_start := (dd + t1) at time zone 'Europe/Berlin';
          w_end := (case when t2 <= t1 then dd + 1 else dd end + t2) at time zone 'Europe/Berlin';
          if w_start <= to_at and w_end > from_at then return true; end if;
        end if;
        continue;
      end if;
  end loop;

  return case when stated then false else null end;
end;
$_$;

CREATE FUNCTION public.autobahn_validity_time(h text, mi text) RETURNS time without time zone
    LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
    AS $_$
begin
  if h !~ '^[0-9]{1,2}$' or mi !~ '^[0-9]{2}$' then return null; end if;
  if h::int = 24 and mi::int = 0 then return make_time(24, 0, 0); end if;
  if h::int > 23 or mi::int > 59 then return null; end if;
  return make_time(h::int, mi::int, 0);
end;
$_$;

CREATE FUNCTION public.charging_house_key(street text, house_number text) RETURNS text
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    RETURN COALESCE("substring"(COALESCE(house_number, ''::text), '[0-9]+'::text), "substring"(COALESCE(street, ''::text), '[0-9]+'::text));

CREATE FUNCTION public.charging_operator_tokens(name text) RETURNS text[]
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    RETURN ARRAY(SELECT DISTINCT t.t FROM unnest(regexp_split_to_array(lower(COALESCE(charging_operator_tokens.name, ''::text)), '[^a-z0-9äöüß]+'::text)) t(t) WHERE ((length(t.t) >= 3) AND (t.t <> ALL (ARRAY['gmbh'::text, 'mbh'::text, 'kgaa'::text, 'ohg'::text, 'gbr'::text, 'und'::text, 'haftungsbeschränkt'::text, 'stadtwerke'::text, 'energie'::text, 'energieversorgung'::text, 'mobility'::text, 'mobilität'::text, 'deutschland'::text, 'germany'::text, 'charging'::text, 'service'::text, 'services'::text, 'solution'::text, 'solutions'::text, 'ladestation'::text, 'ladestationen'::text, 'holding'::text, 'gesellschaft'::text, 'für'::text, 'der'::text, 'die'::text, 'das'::text, 'the'::text, 'emobility'::text, 'recharge'::text, 'inc'::text, 'ltd'::text]))) ORDER BY t.t);

CREATE FUNCTION public.charging_register_free_of_charge(extras jsonb) RETURNS boolean
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    RETURN CASE WHEN (NULLIF(btrim(((extras -> 'device'::text) ->> 'payment'::text)), ''::text) IS NULL) THEN NULL::boolean ELSE (btrim(((extras -> 'device'::text) ->> 'payment'::text)) ~ '(^|;)\s*Kostenlos'::text) END;

CREATE FUNCTION public.charging_register_opening_hours(extras jsonb) RETURNS text
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    RETURN CASE btrim(((extras -> 'device'::text) ->> 'openingHours'::text)) WHEN '247'::text THEN 'always'::text WHEN 'Eingeschränkt'::text THEN 'restricted'::text ELSE NULL::text END;

CREATE FUNCTION public.charging_register_parking(extras jsonb) RETURNS text
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    RETURN CASE WHEN (lower(btrim(((extras -> 'device'::text) ->> 'parking'::text))) = 'keine beschränkung'::text) THEN 'public'::text WHEN (lower(((extras -> 'device'::text) ->> 'parking'::text)) ~~ '%kunden%'::text) THEN 'customers'::text ELSE NULL::text END;

CREATE FUNCTION public.charging_register_payment_card(extras jsonb) RETURNS boolean
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    RETURN CASE WHEN (NULLIF(btrim(((extras -> 'device'::text) ->> 'payment'::text)), ''::text) IS NULL) THEN NULL::boolean ELSE (btrim(((extras -> 'device'::text) ->> 'payment'::text)) ~ '(Kredit|Debit)karte'::text) END;

CREATE FUNCTION public.charging_status_runs_note() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  insert into charging_status_runs as s (observed_at, source_feed, source_run_id, is_delta, stated_at, ticks)
  select n.observed_at, n.source_feed, n.source_run_id, d.is_delta,
         max(least(coalesce(case when d.is_delta then n.last_updated else n.feed_ts end, n.observed_at), n.observed_at)),
         count(*)::int
    from new_ticks n
   cross join lateral (select coalesce(lower(btrim(n.exchange_protocol)) = 'deltapull', false) as is_delta) d
   where coalesce(n.confidentiality, 'noRestriction') = 'noRestriction'
   group by n.observed_at, n.source_feed, n.source_run_id, d.is_delta
  on conflict on constraint charging_status_runs_key do update
     set stated_at = greatest(s.stated_at, excluded.stated_at),
         ticks = s.ticks + excluded.ticks;
  if pg_try_advisory_xact_lock(1289001) then
    delete from charging_status_runs where observed_at < now() - interval '35 days';
  end if;
  return null;
end
$$;

CREATE FUNCTION public.charging_status_runs_recompute() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  create temp table if not exists charging_status_runs_keys (observed_at timestamptz, source_feed text, source_run_id bigint) on commit drop;
  insert into charging_status_runs_keys select distinct o.observed_at, o.source_feed, o.source_run_id from old_ticks o;
  if tg_op = 'UPDATE' then
    insert into charging_status_runs_keys select distinct n.observed_at, n.source_feed, n.source_run_id from new_ticks n;
  end if;
  delete from charging_status_runs s
   using charging_status_runs_keys k
   where s.observed_at = k.observed_at and s.source_feed = k.source_feed and s.source_run_id is not distinct from k.source_run_id;
  insert into charging_status_runs (observed_at, source_feed, source_run_id, is_delta, stated_at, ticks)
  select t.observed_at, t.source_feed, t.source_run_id, d.is_delta,
         max(least(coalesce(case when d.is_delta then t.last_updated else t.feed_ts end, t.observed_at), t.observed_at)),
         count(*)::int
    from (select distinct * from charging_status_runs_keys) k
    join charging_point_status t
      on t.observed_at = k.observed_at and t.source_feed = k.source_feed and t.source_run_id is not distinct from k.source_run_id
   cross join lateral (select coalesce(lower(btrim(t.exchange_protocol)) = 'deltapull', false) as is_delta) d
   where coalesce(t.confidentiality, 'noRestriction') = 'noRestriction'
   group by t.observed_at, t.source_feed, t.source_run_id, d.is_delta;
  delete from charging_status_runs_keys;
  return null;
end
$$;

CREATE FUNCTION public.charging_street_key(street text) RETURNS text
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    RETURN regexp_replace(regexp_replace(replace(lower(COALESCE(street, ''::text)), 'ß'::text, 'ss'::text), 'strasse|str\.'::text, 'str'::text, 'g'::text), '[^a-zäöü]'::text, ''::text, 'g'::text);

CREATE FUNCTION public.ensure_daily_partitions(days_ahead integer DEFAULT 7) RETURNS void
    LANGUAGE plpgsql
    AS $$
declare
  days_back constant integer := 3;
  min_tick_tables integer;
  daily_exempt constant text[] := '{}';
  t text; d date; part text;
  covered text[]; n integer; made integer := 0; stray text;
  summarized integer := 0;
begin
  select coalesce(array_agg(c.relname order by c.relname), '{}')
    into covered
    from pg_partitioned_table p
    join pg_class c on c.oid = p.partrelid
    join pg_namespace ns on ns.oid = c.relnamespace
   where ns.nspname = current_schema()
     and p.partstrat = 'r'
     and p.partnatts = 1
     and (select a.attname from pg_attribute a
           where a.attrelid = c.oid and a.attnum = p.partattrs[0]) = 'observed_at';
  n := coalesce(array_length(covered, 1), 0);

  select s.min_daily_tables into min_tick_tables from partition_settings s where s.singleton;
  if min_tick_tables is null then
    raise exception 'ensure_daily_partitions: no row in partition_settings, so the floor of tick tables is unknown — restore it (insert into partition_settings (min_daily_tables) values (<count of tick tables>)) rather than run without one.';
  end if;

  if n < min_tick_tables then
    raise exception 'ensure_daily_partitions: % range-partitioned table(s) keyed on observed_at in schema %, expected at least % — a tick table has left the daily schedule (renamed, un-partitioned, or its partition key is no longer observed_at). Covered: %.',
      n, current_schema(), min_tick_tables, covered;
  end if;

  select string_agg(format('%s partitioned by %s', c.relname, pg_get_partkeydef(c.oid)), '; ' order by c.relname)
    into stray
    from pg_partitioned_table p
    join pg_class c on c.oid = p.partrelid
    join pg_namespace ns on ns.oid = c.relnamespace
   where ns.nspname = current_schema()
     and p.partstrat = 'r'
     and not (c.relname = any(covered))
     and not (c.relname = any(coalesce(daily_exempt, '{}')));
  if stray is not null then
    raise exception 'ensure_daily_partitions: range-partitioned table(s) outside the daily schedule in schema %: %. A tick table joins the schedule by being range-partitioned on a single observed_at column — key it that way, or add it to daily_exempt in a new migration and say why. It currently gets NO partitions, and its first insert fails with "no partition of relation ... found for row".',
      current_schema(), stray;
  end if;

  foreach t in array covered loop
    for i in -days_back..days_ahead loop
      d := (current_date + i);
      part := format('%s_%s', t, to_char(d, 'YYYYMMDD'));
      if to_regclass(part) is null then
        execute format('create table %I (like %I including all excluding indexes excluding statistics)', part, t);
        execute format('alter table %I attach partition %I for values from (%L) to (%L)',
                       t, part, d::timestamptz, (d + 1)::timestamptz);
        made := made + 1;
      end if;
      summarized := summarized + tick_brin_autosummarize(format('%I.%I', current_schema(), part)::regclass);
    end loop;
  end loop;

  raise notice 'ensure_daily_partitions: % table(s) on the daily schedule, days % .. %, % partition(s) created, % BRIN index(es) set to autosummarize',
    n, current_date - days_back, current_date + days_ahead, made, summarized;
end $$;

CREATE FUNCTION public.feed_versions_bump() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  l text;
  k text;
  v bigint;
  t timestamptz;
  top_items integer;
  top_started timestamptz;
begin
  if tg_table_name = 'feed_runs' then
    l := 'feed';
    k := new.feed_key;
  else
    l := 'ingest';
    k := new.provider;
  end if;
  if new.status in ('ok', 'degraded') then
    insert into feed_versions as fv (ledger, key, version, observed_at)
    values (l, k, 1, new.finished_at)
    on conflict (ledger, key) do update
       set version = fv.version + 1,
           observed_at = greatest(fv.observed_at, excluded.observed_at)
    returning fv.version into v;
  end if;
  if l = 'feed' and new.status in ('ok', 'unchanged', 'degraded') then
    if v is null then
      select fv.version into v from feed_versions fv where fv.ledger = 'feed' and fv.key = k;
    end if;
    perform 1 from feed_run_extents e where e.feed_key = k for update;
    select greatest(new.finished_at, max(e.computed_at)) into t from feed_run_extents e where e.feed_key = k;
    select x.items_seen, x.started_at into top_items, top_started
      from feed_runs x
     where x.feed_key = k
       and x.status in ('ok', 'unchanged', 'degraded')
       and x.items_seen is not null
       and x.started_at > t - interval '48 hours'
       and x.started_at <= t
     order by x.items_seen desc, x.started_at desc
     limit 1;
    insert into feed_run_extents as e (feed_key, max_items, max_started_at, computed_at, version)
    values (k, top_items, top_started, t, coalesce(v, 0))
    on conflict (feed_key) do update
       set max_items = excluded.max_items,
           max_started_at = excluded.max_started_at,
           computed_at = excluded.computed_at,
           version = excluded.version;
  end if;
  return null;
end
$$;

CREATE FUNCTION public.feed_versions_forget() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
begin
  insert into feed_versions as fv (ledger, key, version, observed_at)
  select 'feed', d.feed_key, 1, now() from (select distinct o.feed_key from old_runs o) d
  on conflict (ledger, key) do update
     set version = fv.version + 1,
         observed_at = greatest(fv.observed_at, excluded.observed_at);
  perform 1 from feed_run_extents e
   where e.feed_key in (select o.feed_key from old_runs o)
   order by e.feed_key
     for update;
  update feed_run_extents e
     set (max_items, max_started_at) = (
           select x.items_seen, x.started_at
             from feed_runs x
            where x.feed_key = e.feed_key
              and x.status in ('ok', 'unchanged', 'degraded')
              and x.items_seen is not null
              and x.started_at > e.computed_at - interval '48 hours'
              and x.started_at <= e.computed_at
            order by x.items_seen desc, x.started_at desc
            limit 1),
         version = coalesce((select fv.version from feed_versions fv where fv.ledger = 'feed' and fv.key = e.feed_key), 0)
   where e.feed_key in (select o.feed_key from old_runs o);
  return null;
end
$$;

CREATE FUNCTION public.fuel_price_outliers(lo numeric, hi numeric, jump numeric, since interval DEFAULT '24:00:00'::interval) RETURNS TABLE(observed_at timestamp with time zone, station_id text, product text, price numeric, prev_price numeric, kind text)
    LANGUAGE sql STABLE
    AS $$
  with t as (
    select p.observed_at, p.station_id, p.product, p.price,
           lag(p.price) over (partition by p.station_id, p.product order by p.observed_at) as prev_price
      from fuel_prices p
     where p.observed_at >= now() - since - interval '1 day'
  )
  select t.observed_at, t.station_id, t.product, t.price, t.prev_price,
         case when t.price < lo or t.price > hi then 'band' else 'jump' end as kind
    from t
   where t.observed_at >= now() - since
     and (t.price < lo or t.price > hi
          or (t.prev_price is not null and t.prev_price > 0 and abs(t.price - t.prev_price) / t.prev_price > jump))
   order by t.observed_at desc
$$;

CREATE FUNCTION public.fuel_station_land(p public.geography) RETURNS text
    LANGUAGE sql STABLE PARALLEL SAFE
    AS $$
  select case when p is null then null else (
    select left(g.admin_code, 2)
      from gazetteer_places g
     where g.source_id = 'bkg_gvisys'
       and g.kind = 'city'
       and g.geom is not null
       and g.closed_at is null
     order by g.geom <-> p
     limit 1) end
$$;

CREATE FUNCTION public.fuel_station_town_places(p public.geography) RETURNS jsonb
    LANGUAGE sql STABLE PARALLEL SAFE
    AS $$
  select case when p is null then null else (
    select coalesce(jsonb_agg(jsonb_build_object('ags', n.admin_code, 'name', n.name) order by n.d), '[]'::jsonb)
      from (select g.admin_code, g.name, g.geom <-> p as d
              from gazetteer_places g
             where g.source_id = 'bkg_gvisys'
               and g.kind = 'city'
               and g.geom is not null
               and g.closed_at is null
             order by g.geom <-> p
             limit 5) n
     where n.d <= 20000) end
$$;

CREATE FUNCTION public.fuel_stations_relabel_land() RETURNS integer
    LANGUAGE plpgsql
    AS $$
declare
  n integer;
begin
  update fuel_stations s
     set land = x.land,
         town_places = x.town_places
    from (select id, fuel_station_land(geom) as land, fuel_station_town_places(geom) as town_places from fuel_stations) x
   where x.id = s.id
     and (s.land is distinct from x.land or s.town_places is distinct from x.town_places);
  get diagnostics n = row_count;
  return n;
end
$$;

CREATE FUNCTION public.fuel_stations_set_land() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new.land := fuel_station_land(new.geom);
  new.town_places := fuel_station_town_places(new.geom);
  return new;
end
$$;

CREATE FUNCTION public.fuel_warm_cadence(p_city_population_min integer, p_city_radius_min_m double precision, p_city_radius_max_m double precision, p_city_radius_per_sqrt_thousand_m double precision, p_motorway_corridor_m double precision, p_failure_threshold integer, p_days integer) RETURNS TABLE(median_gap_s double precision, samples integer)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $_$
  with cities as (
    select g.geom, g.population,
           least(p_city_radius_max_m, greatest(p_city_radius_min_m, p_city_radius_per_sqrt_thousand_m * sqrt(g.population::float8 / 1000))) as r
      from gazetteer_places g
     where g.closed_at is null and g.kind = 'city' and g.source_id = 'bkg_gvisys'
       and g.admin_code ~ '^[0-9]{8}$' and g.geom is not null and g.population >= p_city_population_min
  ),
  warm_ids as (
    select s.id from cities c join fuel_stations_live s on ST_DWithin(s.geom, c.geom, c.r)
    union
    select s.id from motorway_points_live m join fuel_stations_live s on ST_DWithin(s.geom, m.geom, p_motorway_corridor_m)
  ),
  gaps as (
    select extract(epoch from p.observed_at - lag(p.observed_at) over (partition by p.station_id, p.product order by p.observed_at)) as gap_s
      from fuel_prices p
     where p.observed_at >= now() - make_interval(days => p_days)
       and p.station_id in (select id from warm_ids)
  )
  select percentile_cont(0.5) within group (order by gap_s), count(*)::int
    from gaps where gap_s is not null and gap_s > 0
$_$;

CREATE FUNCTION public.growth_weekly_refresh(p_weeks integer DEFAULT 2) RETURNS integer
    LANGUAGE plpgsql
    AS $_$
declare
  today   date := (now() at time zone 'Europe/Berlin')::date;
  this_w  date := today - (extract(isodow from today)::integer - 1);
  w       date;
  w_from  timestamptz;
  w_to    timestamptz;
  oldest  timestamptz;
  n       integer := 0;
begin
  if p_weeks is null or p_weeks < 1 or p_weeks > 105 then
    raise exception 'growth_weekly_refresh: p_weeks must be 1..105 (got %)', p_weeks;
  end if;
  select min(period_start) into oldest from mcp_usage where period = 'hour';
  for i in 0 .. p_weeks - 1 loop
    w := this_w - 7 * i;
    w_from := w::timestamp at time zone 'Europe/Berlin';
    w_to := (w + 7)::timestamp at time zone 'Europe/Berlin';
    insert into growth_weekly as g (
      week, computed_at, complete,
      search_state, search_impressions, search_clicks, search_position,
      site_state, site_days, people_views, own_views, crawler_views, automation_views, home_views, connect_views,
      mcp_state, mcp_initialize_ext, mcp_calls_ext, mcp_errors_ext, mcp_clients_ext, mcp_calls_own, directory_listings)
    select w, now(), w + 7 <= today,
           case when sc.state = 'read' then 'read' else 'unread' end,
           case when sc.state = 'read' then sc.impressions end,
           case when sc.state = 'read' then sc.clicks end,
           case when sc.state = 'read' then sc.position end,
           case when sv.labelled = 7 then 'read' when sv.days > 0 then 'partial' else 'unread' end,
           coalesce(sv.days, 0),
           case when sv.days > 0 then sv.page_views - coalesce(sv.own, 0) end,
           case when sv.days > 0 then sv.own end,
           case when sv.days > 0 then sv.crawler end,
           case when sv.days > 0 then sv.automated - coalesce(sv.crawler, 0) end,
           case when sv.days > 0 then coalesce(rt.home, 0) end,
           case when sv.days > 0 then coalesce(rt.connect, 0) end,
           case when oldest is not null and oldest <= w_from then 'read' else 'unread' end,
           case when oldest is not null and oldest <= w_from then coalesce(mu.init_ext, 0) end,
           case when oldest is not null and oldest <= w_from then coalesce(mu.calls_ext, 0) end,
           case when oldest is not null and oldest <= w_from then coalesce(mu.errors_ext, 0) end,
           case when oldest is not null and oldest <= w_from then coalesce(mu.clients_ext, 0) end,
           case when oldest is not null and oldest <= w_from then coalesce(mu.calls_own, 0) end,
           null
      from (select 1) one
      left join search_console_weekly sc on sc.week = w
      left join lateral (
        select count(*)::integer as days,
               (count(*) filter (where d.own_views is not null and d.crawler_views is not null))::integer as labelled,
               sum(d.page_views)::integer as page_views,
               sum(d.own_views)::integer as own,
               sum(d.crawler_views)::integer as crawler,
               sum(coalesce(d.automated, 0))::integer as automated
          from site_visits_daily d
         where d.day >= w and d.day < w + 7
      ) sv on true
      left join lateral (
        select (sum(r.views) filter (where r.route = '/' or r.route ~ '^/[a-z]{2}$'))::integer as home,
               (sum(r.views) filter (where r.route ~ '^/[a-z]{2}/connect$'))::integer as connect
          from site_visits_routes r
         where r.day >= w and r.day < w + 7
      ) rt on true
      left join lateral (
        select (sum(m.sessions) filter (where m.rpc = 'initialize' and mcp_usage_traffic_class(m.client) = 'real'))::integer as init_ext,
               (sum(m.requests) filter (where m.rpc = 'tools/call' and mcp_usage_traffic_class(m.client) = 'real'))::integer as calls_ext,
               (sum(greatest(coalesce(m.tool_errors, 0) - (m.tool_error_invalid_input + m.tool_error_not_found + m.tool_error_out_of_coverage), 0)
                    + coalesce(m.server_errors, 0)) filter (where m.rpc = 'tools/call' and mcp_usage_traffic_class(m.client) = 'real'))::integer as errors_ext,
               (count(distinct m.client) filter (where m.rpc = 'initialize' and m.sessions > 0 and mcp_usage_traffic_class(m.client) = 'real'))::integer as clients_ext,
               (sum(m.requests) filter (where m.rpc = 'tools/call' and mcp_usage_traffic_class(m.client) = 'own'))::integer as calls_own
          from mcp_usage m
         where m.period = 'hour' and m.period_start >= w_from and m.period_start < w_to
      ) mu on true
    on conflict (week) do update set
      computed_at = excluded.computed_at, complete = excluded.complete,
      search_state = excluded.search_state, search_impressions = excluded.search_impressions,
      search_clicks = excluded.search_clicks, search_position = excluded.search_position,
      site_state = excluded.site_state, site_days = excluded.site_days, people_views = excluded.people_views,
      own_views = excluded.own_views, crawler_views = excluded.crawler_views, automation_views = excluded.automation_views,
      home_views = excluded.home_views, connect_views = excluded.connect_views,
      mcp_state = excluded.mcp_state, mcp_initialize_ext = excluded.mcp_initialize_ext, mcp_calls_ext = excluded.mcp_calls_ext,
      mcp_errors_ext = excluded.mcp_errors_ext, mcp_clients_ext = excluded.mcp_clients_ext, mcp_calls_own = excluded.mcp_calls_own,
      directory_listings = excluded.directory_listings;
    n := n + 1;
  end loop;
  delete from growth_weekly where week < this_w - 7 * 104;
  delete from search_console_weekly where week < this_w - 7 * 104;
  return n;
end $_$;

CREATE FUNCTION public.lez_zone_overlaps_refresh(p_feed text, p_zone text) RETURNS void
    LANGUAGE plpgsql
    AS $$
begin
  perform pg_advisory_xact_lock(hashtext('lez_zone_overlaps'));
  delete from lez_zone_overlaps
   where (source_feed = p_feed and zone_id = p_zone)
      or (other_feed = p_feed and other_zone_id = p_zone);
  insert into lez_zone_overlaps (source_feed, zone_id, other_feed, other_zone_id, shared_area, smaller_area)
  select x.f1, x.z1, x.f2, x.z2, m.shared_area, m.smaller_area
    from lez_zones a
    join lez_zones b
      on b.source_feed <> a.source_feed
     and b.role = 'zone'
     and b.closed_at is null
     and b.geom && a.geom
     and st_intersects(a.geom, b.geom)
     and not st_touches(a.geom, b.geom)
   cross join lateral (select st_area(st_intersection(a.geom, b.geom)) as shared_area,
                              least(st_area(a.geom), st_area(b.geom)) as smaller_area) m
   cross join lateral (values (a.source_feed, a.zone_id, b.source_feed, b.zone_id),
                              (b.source_feed, b.zone_id, a.source_feed, a.zone_id)) x(f1, z1, f2, z2)
   where a.source_feed = p_feed
     and a.zone_id = p_zone
     and a.role = 'zone'
     and a.closed_at is null;
end
$$;

CREATE FUNCTION public.lez_zones_overlaps_trigger() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if tg_op = 'UPDATE'
     and old.geom is not distinct from new.geom
     and old.role is not distinct from new.role
     and old.closed_at is not distinct from new.closed_at
     and old.source_feed is not distinct from new.source_feed
     and old.zone_id is not distinct from new.zone_id then
    return null;
  end if;
  perform lez_zone_overlaps_refresh(new.source_feed, new.zone_id);
  return null;
end
$$;

CREATE FUNCTION public.mcp_usage_traffic_class(client text) RETURNS text
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    AS $$
  select case when client in ('viafrei-smoke', 'release-probe', 'viafrei-status-probe', 'deploy-probe', 'prod-round', 'viafrei-soak', 'viafrei-test-round', 'viafrei-own') then 'own'
              when client in ('unknown', 'stateless') then 'scanners'
              else 'real' end
$$;

CREATE FUNCTION public.ops_audit_append_only() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if tg_op = 'UPDATE'
     and old.at < now() - interval '12 months'
     and old.client_ip is not null
     and new.client_ip is null
     and (to_jsonb(new) - 'client_ip') = (to_jsonb(old) - 'client_ip')
  then
    return new;
  end if;
  raise exception 'ops_audit is append-only: % refused', tg_op using errcode = 'P0001';
end $$;

CREATE FUNCTION public.ops_audit_forget_ips() RETURNS integer
    LANGUAGE plpgsql
    AS $$
declare
  t0 timestamptz := clock_timestamp();
  n  integer;
begin
  update ops_audit
     set client_ip = null
   where client_ip is not null
     and at < now() - interval '12 months';
  get diagnostics n = row_count;
  if n > 0 or not exists (
       select 1 from ingest_runs
        where provider = 'ops_audit_retention'
          and started_at > now() - interval '24 hours') then
    insert into ingest_runs (provider, started_at, finished_at, status, rows, duration_ms, note)
    values ('ops_audit_retention', t0, clock_timestamp(), 'ok', n,
            greatest(0, round(extract(epoch from clock_timestamp() - t0) * 1000))::integer,
            format('ops_audit.client_ip set to NULL on %s row(s) older than 12 months', n));
  end if;
  return n;
end $$;

CREATE FUNCTION public.ops_passkeys_cap() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  perform pg_advisory_xact_lock(hashtext('ops_passkeys_cap'));
  if (select count(*) from ops_passkeys) >= 10 then
    raise exception 'ops_passkeys holds at most ten passkeys' using errcode = 'P0001';
  end if;
  return new;
end $$;

CREATE FUNCTION public.ops_passkeys_counter() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if new.sign_count < old.sign_count then
    raise exception 'ops_passkeys.sign_count may not decrease (% -> %)', old.sign_count, new.sign_count using errcode = 'P0001';
  end if;
  return new;
end $$;

CREATE FUNCTION public.ops_requests_rate_limit() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if new.action <> 'restart' then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtext('ops_requests:' || new.target));
  if exists (
    select 1 from ops_requests r
     where r.action = 'restart'
       and r.target = new.target
       and r.state <> 'refused'
       and r.requested_at > new.requested_at - interval '5 minutes'
  ) then
    raise exception 'ops_requests: % was asked to restart less than five minutes ago', new.target
      using errcode = 'P0001', hint = 'one restart per worker per five minutes';
  end if;
  return new;
end $$;

CREATE FUNCTION public.ops_requests_source_guard() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $_$
declare
  s record;
  floor_s integer;
begin
  if new.action <> 'run-now' or new.target !~ '^[a-z][a-z0-9_]{0,63}$' then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtext('ops_requests:run-now:' || new.target));
  select ss.last_request_at, ss.floor_s, fc.min_interval_s
    into s
    from source_schedule ss
    left join feed_catalog fc on fc.feed_key = ss.source_key and fc.closed_at is null
   where ss.source_key = new.target;
  if not found then
    raise exception 'ops_requests: no engine runs a source named %', new.target
      using errcode = 'P0001', detail = 'unknown-source',
            hint = 'a run-now names a source_schedule row';
  end if;
  floor_s := greatest(coalesce(s.min_interval_s, 0), s.floor_s);
  if s.last_request_at is not null
     and new.requested_at < s.last_request_at + make_interval(secs => floor_s) then
    raise exception 'ops_requests: % asked its provider less than % s ago', new.target, floor_s
      using errcode = 'P0001', detail = 'below-floor',
            hint = 'a run-now never moves a licence floor';
  end if;
  if exists (
    select 1 from ops_requests r
     where r.action = 'run-now' and r.target = new.target and r.state = 'pending'
  ) then
    raise exception 'ops_requests: a run-now of % is already waiting', new.target
      using errcode = 'P0001', detail = 'already-pending',
            hint = 'one pending run-now per source';
  end if;
  return new;
end $_$;

CREATE FUNCTION public.ops_rollup_refresh(p_from timestamp with time zone DEFAULT (now() - '02:00:00'::interval), p_to timestamp with time zone DEFAULT now()) RETURNS TABLE(bucket_rows integer, daily_rows integer, usage_rows integer, held_rows integer, partitions_created integer, partitions_dropped integer)
    LANGUAGE plpgsql
    AS $_$
declare
  origin constant timestamptz := timestamptz '2000-01-01 00:00:00+00';
  v_from timestamptz;
  v_to   timestamptz;
  d      date;
  part   text;
  n_bucket integer := 0; n_tmp integer := 0;
  n_daily integer := 0; n_usage integer := 0; n_held integer := 0;
  n_made integer := 0; n_dropped integer := 0;
  b_from date; b_to date;
  rel record;
begin
  if p_from is null or p_to is null or p_to <= p_from then
    raise exception 'ops_rollup_refresh: the window must be non-empty (from % to %)', p_from, p_to;
  end if;
  if p_to - p_from > interval '8 days' then
    raise exception 'ops_rollup_refresh: a window of % is longer than 8 days — backfill in chunks', p_to - p_from;
  end if;
  v_from := date_bin('5 minutes', p_from, origin);
  v_to := p_to;

  for d in select g::date from generate_series((v_from at time zone 'UTC')::date, (v_to at time zone 'UTC')::date, interval '1 day') g loop
    part := format('ops_rollup_feed_%s', to_char(d, 'YYYYMMDD'));
    if to_regclass(part) is null then
      execute format('create table %I partition of ops_rollup_feed for values in (%L)', part, d);
      n_made := n_made + 1;
    end if;
  end loop;

  with recursive keys(k) as (
    (select r.feed_key from feed_runs r order by r.feed_key limit 1)
    union all
    select (select r.feed_key from feed_runs r where r.feed_key > keys.k order by r.feed_key limit 1)
      from keys where keys.k is not null
  )
  insert into ops_rollup_feed as t (
    bucket_day, bucket_start, ledger, key, runs, ok, unchanged, degraded, error, quiet, running,
    items_seen, items_inserted, items_updated, items_closed, duration_ms_sum, duration_n,
    last_started_at, last_status, last_success_at, computed_at)
  select (x.b at time zone 'UTC')::date, x.b, 'feed', keys.k, x.runs, x.ok, x.unchanged, x.degraded, x.error, x.quiet, 0,
         x.seen, x.ins, x.upd, x.clo, x.dsum, x.dn, x.last_started, x.last_status, x.last_success, now()
    from keys
    cross join lateral (
      select date_bin('5 minutes', r.started_at, origin) as b,
             count(*)::integer as runs,
             count(*) filter (where r.status = 'ok')::integer as ok,
             count(*) filter (where r.status = 'unchanged')::integer as unchanged,
             count(*) filter (where r.status = 'degraded')::integer as degraded,
             count(*) filter (where r.status = 'error')::integer as error,
             count(*) filter (where r.status in ('pending', 'held', 'skipped'))::integer as quiet,
             coalesce(sum(r.items_seen), 0) as seen,
             coalesce(sum(r.items_inserted), 0) as ins,
             coalesce(sum(r.items_updated), 0) as upd,
             coalesce(sum(r.items_closed), 0) as clo,
             coalesce(sum(r.duration_ms), 0) as dsum,
             count(r.duration_ms)::integer as dn,
             max(r.started_at) as last_started,
             (array_agg(r.status order by r.started_at desc))[1] as last_status,
             max(r.started_at) filter (where r.status in ('ok', 'unchanged', 'degraded')) as last_success
        from feed_runs r
       where r.feed_key = keys.k and r.started_at >= v_from and r.started_at < v_to
       group by 1
    ) x
   where keys.k is not null
     and keys.k ~ '^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,79}$'
  on conflict (bucket_day, bucket_start, ledger, key) do update set
    runs = excluded.runs, ok = excluded.ok, unchanged = excluded.unchanged, degraded = excluded.degraded,
    error = excluded.error, quiet = excluded.quiet, running = excluded.running,
    items_seen = excluded.items_seen, items_inserted = excluded.items_inserted,
    items_updated = excluded.items_updated, items_closed = excluded.items_closed,
    duration_ms_sum = excluded.duration_ms_sum, duration_n = excluded.duration_n,
    last_started_at = excluded.last_started_at, last_status = excluded.last_status,
    last_success_at = excluded.last_success_at, computed_at = excluded.computed_at;
  get diagnostics n_bucket = row_count;

  with recursive keys(k) as (
    (select r.provider from ingest_runs r order by r.provider limit 1)
    union all
    select (select r.provider from ingest_runs r where r.provider > keys.k order by r.provider limit 1)
      from keys where keys.k is not null
  )
  insert into ops_rollup_feed as t (
    bucket_day, bucket_start, ledger, key, runs, ok, unchanged, degraded, error, quiet, running,
    items_seen, items_inserted, items_updated, items_closed, duration_ms_sum, duration_n,
    last_started_at, last_status, last_success_at, computed_at)
  select (x.b at time zone 'UTC')::date, x.b, 'ingest', keys.k, x.runs, x.ok, 0, x.degraded, x.error, x.quiet, x.running,
         x.seen, 0, 0, 0, x.dsum, x.dn, x.last_started, x.last_status, x.last_success, now()
    from keys
    cross join lateral (
      select date_bin('5 minutes', r.started_at, origin) as b,
             count(*)::integer as runs,
             count(*) filter (where r.status = 'ok')::integer as ok,
             count(*) filter (where r.status = 'degraded')::integer as degraded,
             count(*) filter (where r.status = 'error')::integer as error,
             count(*) filter (where r.status not in ('ok', 'degraded', 'error', 'running'))::integer as quiet,
             count(*) filter (where r.status = 'running')::integer as running,
             coalesce(sum(r.rows), 0) as seen,
             coalesce(sum(coalesce(r.duration_ms, (extract(epoch from (r.finished_at - r.started_at)) * 1000)::integer)), 0) as dsum,
             count(coalesce(r.duration_ms::numeric, extract(epoch from (r.finished_at - r.started_at))))::integer as dn,
             max(r.started_at) as last_started,
             (array_agg(r.status order by r.started_at desc))[1] as last_status,
             max(r.started_at) filter (where r.status in ('ok', 'degraded')) as last_success
        from ingest_runs r
       where r.provider = keys.k and r.started_at >= v_from and r.started_at < v_to
       group by 1
    ) x
   where keys.k is not null
     and keys.k ~ '^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,79}$'
  on conflict (bucket_day, bucket_start, ledger, key) do update set
    runs = excluded.runs, ok = excluded.ok, degraded = excluded.degraded, error = excluded.error,
    quiet = excluded.quiet, running = excluded.running, items_seen = excluded.items_seen,
    duration_ms_sum = excluded.duration_ms_sum, duration_n = excluded.duration_n,
    last_started_at = excluded.last_started_at, last_status = excluded.last_status,
    last_success_at = excluded.last_success_at, computed_at = excluded.computed_at;
  get diagnostics n_tmp = row_count;
  n_bucket := n_bucket + n_tmp;

  b_from := (v_from at time zone 'Europe/Berlin')::date;
  b_to := (v_to at time zone 'Europe/Berlin')::date;
  insert into ops_rollup_daily as t (
    day, ledger, key, runs, ok, unchanged, degraded, error, quiet,
    items_seen, items_inserted, items_updated, items_closed,
    buckets_with_runs, buckets_with_success, last_success_at, computed_at)
  select (f.bucket_start at time zone 'Europe/Berlin')::date, f.ledger, f.key,
         sum(f.runs)::integer, sum(f.ok)::integer, sum(f.unchanged)::integer, sum(f.degraded)::integer,
         sum(f.error)::integer, sum(f.quiet)::integer,
         sum(f.items_seen), sum(f.items_inserted), sum(f.items_updated), sum(f.items_closed),
         count(*)::integer, (count(*) filter (where f.last_success_at is not null))::integer,
         max(f.last_success_at), now()
    from ops_rollup_feed f
   where f.bucket_day between b_from - 1 and b_to + 1
     and (f.bucket_start at time zone 'Europe/Berlin')::date between b_from and b_to
   group by 1, 2, 3
  on conflict (day, ledger, key) do update set
    runs = excluded.runs, ok = excluded.ok, unchanged = excluded.unchanged, degraded = excluded.degraded,
    error = excluded.error, quiet = excluded.quiet, items_seen = excluded.items_seen,
    items_inserted = excluded.items_inserted, items_updated = excluded.items_updated,
    items_closed = excluded.items_closed, buckets_with_runs = excluded.buckets_with_runs,
    buckets_with_success = excluded.buckets_with_success, last_success_at = excluded.last_success_at,
    computed_at = excluded.computed_at;
  get diagnostics n_daily = row_count;

  n_usage := ops_rollup_usage_fold(b_from, b_to);

  for rel in
    select * from (values
      ('fuel_stations', 'fuel_stations'),
      ('charging_points', 'charging_points'),
      ('parking_facilities', 'parking_facilities'),
      ('road_events', 'road_messages'),
      ('stops', 'stops'),
      ('stop_times', 'scheduled_stop_times'),
      ('gazetteer_places', 'places'),
      ('weather_warnings', 'weather_warnings')
    ) v(relname, kind)
  loop
    if to_regclass(rel.relname) is not null then
      insert into ops_rollup_held as t (day, kind, approx_rows, computed_at)
      select (now() at time zone 'Europe/Berlin')::date, rel.kind,
             greatest(0, coalesce(sum(greatest(c.reltuples, 0)), 0))::bigint, now()
        from pg_class c
       where c.oid = to_regclass(rel.relname)
          or c.oid in (select i.inhrelid from pg_inherits i where i.inhparent = to_regclass(rel.relname))
      on conflict (day, kind) do update set approx_rows = excluded.approx_rows, computed_at = excluded.computed_at;
      n_held := n_held + 1;
    end if;
  end loop;

  for part in
    select c.relname
      from pg_inherits i
      join pg_class c on c.oid = i.inhrelid
     where i.inhparent = 'ops_rollup_feed'::regclass
       and c.relname ~ '^ops_rollup_feed_[0-9]{8}$'
       and to_date(substring(c.relname from '([0-9]{8})$'), 'YYYYMMDD') < (now() at time zone 'UTC')::date - 90
  loop
    execute format('drop table %I', part);
    n_dropped := n_dropped + 1;
  end loop;
  delete from ops_rollup_daily where day < (now() at time zone 'Europe/Berlin')::date - 400;
  delete from ops_rollup_usage where day < (now() at time zone 'Europe/Berlin')::date - 400;
  delete from ops_rollup_held  where day < (now() at time zone 'Europe/Berlin')::date - 400;

  perform control.rollup_refresh(greatest(p_from, now() - interval '48 hours'));
  return query select n_bucket, n_daily, n_usage, n_held, n_made, n_dropped;
end $_$;

CREATE FUNCTION public.ops_rollup_usage_fold(b_from date, b_to date) RETURNS integer
    LANGUAGE plpgsql
    AS $_$
declare
  n integer := 0;
begin
  if b_from is null or b_to is null or b_to < b_from then
    raise exception 'ops_rollup_usage_fold: the days must be a non-empty range (from % to %)', b_from, b_to;
  end if;
  insert into ops_rollup_usage as t (
    day, tool, class, calls, errors,
    ms_le_100, ms_le_250, ms_le_500, ms_le_1000, ms_le_2500, ms_le_5000, ms_le_10000, ms_gt_10000, computed_at)
  select (m.period_start at time zone 'Europe/Berlin')::date,
         case when m.tool ~ '^[a-z][a-z0-9_]{0,63}$' then m.tool else 'other' end,
         mcp_usage_traffic_class(m.client),
         sum(m.requests),
         sum(greatest(coalesce(m.tool_errors, 0) - (m.tool_error_invalid_input + m.tool_error_not_found + m.tool_error_out_of_coverage), 0)
             + coalesce(m.server_errors, 0)),
         sum(m.ms_le_100), sum(m.ms_le_250), sum(m.ms_le_500), sum(m.ms_le_1000),
         sum(m.ms_le_2500), sum(m.ms_le_5000), sum(m.ms_le_10000), sum(m.ms_gt_10000), now()
    from mcp_usage m
   where m.period = 'hour'
     and m.rpc = 'tools/call'
     and m.period_start >= (b_from::timestamp at time zone 'Europe/Berlin')
     and m.period_start < ((b_to + 1)::timestamp at time zone 'Europe/Berlin')
   group by 1, 2, 3
  on conflict (day, tool, class) do update set
    calls = excluded.calls, errors = excluded.errors,
    ms_le_100 = excluded.ms_le_100, ms_le_250 = excluded.ms_le_250, ms_le_500 = excluded.ms_le_500,
    ms_le_1000 = excluded.ms_le_1000, ms_le_2500 = excluded.ms_le_2500, ms_le_5000 = excluded.ms_le_5000,
    ms_le_10000 = excluded.ms_le_10000, ms_gt_10000 = excluded.ms_gt_10000, computed_at = excluded.computed_at;
  get diagnostics n = row_count;
  return n;
end $_$;

CREATE FUNCTION public.place_slugs_frozen() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if tg_op = 'DELETE' then
    raise exception 'place_slugs: a slug is assigned once and never freed (ags %, %)', old.ags, old.slug;
  end if;
  if new.slug is distinct from old.slug or new.ags is distinct from old.ags then
    raise exception 'place_slugs: a slug is assigned once and never changed (ags %, % → %)', old.ags, old.slug, new.slug;
  end if;
  return new;
end $$;

CREATE FUNCTION public.road_event_in_force(overall_start timestamp with time zone, overall_end timestamp with time zone, payload jsonb, at timestamp with time zone) RETURNS boolean
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    AS $$
  select case
    when overall_start is not null and overall_start > at then false
    when overall_end   is not null and overall_end   < at then false
    else not road_event_suspended(payload)
  end
$$;

CREATE FUNCTION public.road_event_in_force(overall_start timestamp with time zone, overall_end timestamp with time zone, payload jsonb, valid_windows tstzmultirange, at timestamp with time zone) RETURNS boolean
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    AS $$
  select case
    when valid_windows is not null and not (valid_windows @> at) then false
    else road_event_in_force(overall_start, overall_end, payload, at)
  end
$$;

CREATE FUNCTION public.road_event_in_force_known(overall_start timestamp with time zone, overall_end timestamp with time zone, suspended boolean, payload jsonb, valid_windows tstzmultirange, at timestamp with time zone) RETURNS boolean
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    AS $$
  select case
    when valid_windows is not null and not (valid_windows @> at) then false
    when overall_start is not null and overall_start > at then false
    when overall_end   is not null and overall_end   < at then false
    else not coalesce(suspended, road_event_suspended(payload))
  end
$$;

CREATE FUNCTION public.road_event_suspended(payload jsonb) RETURNS boolean
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    AS $$
  with st as (
    select s ->> '#text' as status
      from jsonb_array_elements(
             case when jsonb_typeof(payload -> 'situationRecord') = 'array'
                  then payload -> 'situationRecord' else '[]'::jsonb end) as rec,
           jsonb_array_elements(
             case when jsonb_typeof(rec -> 'validity') = 'array'
                  then rec -> 'validity' else '[]'::jsonb end) as v,
           jsonb_array_elements(
             case when jsonb_typeof(v -> 'validityStatus') = 'array'
                  then v -> 'validityStatus' else '[]'::jsonb end) as s
  )
  select exists (select 1 from st)
     and not exists (select 1 from st where status is distinct from 'suspended')
$$;

CREATE FUNCTION public.road_events_note_suspended() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new.suspended := road_event_suspended(new.payload);
  return new;
end
$$;

CREATE FUNCTION public.road_ref_key(road text) RETURNS text
    LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
    AS $_$
  select case
    when c = '' then null
    when c ~ '^[A-Z]+[0-9]' then regexp_replace(c, '^([A-Z]+)0*([0-9]+)(.*)$', '\1\2\3')
    else c
  end
  from (select regexp_replace(upper(road), '[[:space:]._-]+', '', 'g') as c) s
$_$;

CREATE FUNCTION public.runtime_config_source_bounds() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $_$
declare
  src text;
  kind text;
  floor_s integer;
  declared_s integer;
  known boolean;
begin
  if new.key !~ '^source\.[a-z][a-z0-9_]{0,63}\.(paused|interval_s)$'
     or new.value !~ '^([0-9]{1,6}|true|false)$' then
    return new;
  end if;
  src  := substring(new.key from '^source\.([a-z][a-z0-9_]{0,63})\.');
  kind := substring(new.key from '\.([a-z_]+)$');
  select true,
         greatest(coalesce(fc.min_interval_s, 0), coalesce(ss.floor_s, 0), 60),
         coalesce(ss.declared_cadence_s, fc.declared_cadence_s, fc.cadence_s)
    into known, floor_s, declared_s
    from (select src as k) q
    left join source_schedule ss on ss.source_key = q.k
    left join feed_catalog fc on fc.feed_key = q.k and fc.closed_at is null
   where ss.source_key is not null or fc.feed_key is not null;
  if known is not true then
    raise exception 'runtime_config: no source named % is declared', src
      using errcode = 'P0001', detail = 'unknown-source',
            hint = 'a source.* key names a feed_catalog or source_schedule row';
  end if;
  if kind = 'interval_s' and new.value ~ '^[0-9]{1,6}$' then
    if new.value::int < floor_s then
      raise exception 'runtime_config: % is below the floor of % (% s)', new.value, src, floor_s
        using errcode = 'P0001', detail = 'below-floor',
              hint = 'a tunable never moves a licence floor';
    end if;
    if declared_s is not null and new.value::int > declared_s * 4 then
      raise exception 'runtime_config: % is more than four times the declared % s of %', new.value, declared_s, src
        using errcode = 'P0001', detail = 'above-stretch',
              hint = 'pause a source instead of slowing it to never';
    end if;
  end if;
  return new;
end $_$;

CREATE FUNCTION public.search_console_weekly_load(doc jsonb) RETURNS text
    LANGUAGE plpgsql
    AS $$
declare
  w date := (doc ->> 'week')::date;
  s text := doc ->> 'state';
  n integer := 0;
begin
  if w is null or s is null then
    raise exception 'search_console_weekly_load: a document needs week and state';
  end if;
  if s <> 'read' and exists (select 1 from search_console_weekly where week = w and state = 'read') then
    update search_console_weekly set tried_at = now() where week = w;
    return s || ' parts=0 kept=read';
  end if;
  delete from search_console_weekly where week = w;
  insert into search_console_weekly (week, state, read_at, impressions, clicks, position, shown_not_clicked, legacy_impressions)
  values (w, s, now(), (doc ->> 'impressions')::bigint, (doc ->> 'clicks')::bigint, (doc ->> 'position')::numeric,
          (doc ->> 'shownNotClicked')::integer, (doc ->> 'legacyImpressions')::bigint);
  if s = 'read' then
    insert into search_console_weekly_parts (week, dimension, key, rows, impressions, clicks, position)
    select w, p ->> 'dimension', p ->> 'key', (p ->> 'rows')::integer, (p ->> 'impressions')::bigint, (p ->> 'clicks')::bigint, (p ->> 'position')::numeric
      from jsonb_array_elements(coalesce(doc -> 'parts', '[]'::jsonb)) p;
    get diagnostics n = row_count;
  end if;
  return s || ' parts=' || n;
end $$;

CREATE FUNCTION public.station_slugs_frozen() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if tg_op = 'DELETE' then
    raise exception 'station_slugs: a slug is assigned once and never freed (%, station %)', old.slug, old.station_no;
  end if;
  if new.slug is distinct from old.slug or new.station_no is distinct from old.station_no then
    raise exception 'station_slugs: a slug is assigned once and never changed (%, station %)', old.slug, old.station_no;
  end if;
  return new;
end $$;

CREATE FUNCTION public.tick_brin_autosummarize(part regclass) RETURNS integer
    LANGUAGE plpgsql
    AS $$
declare
  ix regclass; n integer := 0;
  prev text := current_setting('lock_timeout');
begin
  for ix in
    select i.indexrelid::regclass
      from pg_index i
      join pg_class ic on ic.oid = i.indexrelid
      join pg_am am on am.oid = ic.relam
     where i.indrelid = part
       and am.amname = 'brin'
       and ic.relkind = 'i'
       and array_position(coalesce(ic.reloptions, '{}'), 'autosummarize=on') is null
  loop
    begin
      perform set_config('lock_timeout', '2s', true);
      execute format('alter index %s set (autosummarize = on)', ix);
      n := n + 1;
    exception when lock_not_available or deadlock_detected then
      raise notice 'tick_brin_autosummarize: % is locked by another session (%); skipped, the next run sets it', ix, sqlerrm;
    end;
    perform set_config('lock_timeout', prev, true);
  end loop;
  return n;
end $$;

CREATE FUNCTION public.transit_odbl_departs_at(service_date date, tz text, departure_s integer) RETURNS timestamp with time zone
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    RETURN ((((service_date + '12:00:00'::time without time zone) AT TIME ZONE tz) - '12:00:00'::interval) + make_interval(secs => (departure_s)::double precision));

CREATE FUNCTION public.vf_ledger_mask(t text) RETURNS text
    LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
    RETURN regexp_replace(regexp_replace(t, '(?<![0-9A-Za-z_])[0-9]{1,3}(?:\.[0-9]{1,3}){3}(?![0-9A-Za-z_])'::text, '<ip>'::text, 'g'::text), '(?<![0-9A-Za-z_])(?<![0-9A-Fa-f]:)(?![0-9A-Fa-f:]*[0-9A-Fa-f]{5}:)(?![0-9A-Fa-f:]*[0-9A-Fa-f]{6})(?:[0-9A-Fa-f:]*::[0-9A-Fa-f:]*|[0-9A-Fa-f]{1,4}(?::[0-9A-Fa-f]{1,4}){2,7}:[0-9A-Fa-f]{1,5})(?![0-9A-Za-z_:])'::text, '<ip>'::text, 'g'::text);

CREATE FUNCTION public.vf_page_key(identity text) RETURNS text
    LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE
    AS $$
declare
  h constant bytea := sha256(convert_to(identity, 'UTF8'));
begin
  return chr(97 + get_byte(h, 0) % 26) || chr(97 + get_byte(h, 1) % 26) || chr(97 + get_byte(h, 2) % 26)
      || chr(97 + get_byte(h, 3) % 26) || chr(97 + get_byte(h, 4) % 26) || chr(97 + get_byte(h, 5) % 26)
      || chr(97 + get_byte(h, 6) % 26) || chr(97 + get_byte(h, 7) % 26) || chr(97 + get_byte(h, 8) % 26)
      || chr(97 + get_byte(h, 9) % 26);
end
$$;

CREATE FUNCTION public.vf_postcode(raw text) RETURNS text
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    RETURN CASE WHEN (raw IS NULL) THEN NULL::text WHEN (btrim(raw, ((((((' '::text || chr(9)) || chr(10)) || chr(11)) || chr(12)) || chr(13)) || chr(160))) ~ '^[0-9]{5}$'::text) THEN btrim(raw, ((((((' '::text || chr(9)) || chr(10)) || chr(11)) || chr(12)) || chr(13)) || chr(160))) WHEN (btrim(raw, ((((((' '::text || chr(9)) || chr(10)) || chr(11)) || chr(12)) || chr(13)) || chr(160))) ~ '^[0-9]{4}$'::text) THEN ('0'::text || btrim(raw, ((((((' '::text || chr(9)) || chr(10)) || chr(11)) || chr(12)) || chr(13)) || chr(160)))) WHEN (regexp_count(raw, '(^|[^0-9])[0-9]{5}(?=[^0-9]|$)'::text) = 1) THEN "substring"(raw, '(?:^|[^0-9])([0-9]{5})(?:[^0-9]|$)'::text) ELSE NULL::text END;

CREATE FUNCTION public.vf_postcode_normalise() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new.postcode := vf_postcode(new.postcode);
  return new;
end;
$$;

CREATE FUNCTION public.watch_events_notify() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  perform pg_notify(
    'viafrei_watch',
    format('{"v":1,"watch_id":%s,"event_id":%s}', new.watch_id, new.id)
  );
  return null;
end;
$$;

CREATE FUNCTION public.watches_enforce_session_limit() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
declare
  open_count integer;
  limit_per_session constant integer := 10;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.session_id, 0));
  select count(*) into open_count
    from watches
   where session_id = new.session_id and stopped_at is null;
  if open_count >= limit_per_session then
    raise exception
      'session already has % open watches; the limit is % per session — stop one before starting another',
      open_count, limit_per_session
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

CREATE FUNCTION public.weather_warning_english(german_id bigint) RETURNS TABLE(en_headline text, en_description text, en_instruction text, en_sha256 text)
    LANGUAGE sql STABLE SECURITY DEFINER ROWS 1
    SET search_path TO 'public', 'pg_temp'
    AS $$
  select e.headline, e.description, e.instruction, e.content_sha256
    from weather_warnings_live w
    join weather_warnings_en_live e
      on e.sent_at = w.published_at
     and e.valid_from = w.valid_from
     and e.valid_to is not distinct from w.valid_to
     and w.warncell_id = any (e.warncell_ids)
     and e.event_ii = w.raw->'properties'->>'EC_II'
   where w.id = german_id
   order by e.sent_at desc nulls last
   limit 1
$$;

SET default_tablespace = '';

SET default_table_access_method = heap;

CREATE TABLE control.budget_state (
    budget_key text NOT NULL,
    last_admitted_at timestamp with time zone,
    last_admitted_by text,
    person_wanted_at timestamp with time zone,
    held_until timestamp with time zone,
    held_reason text,
    owed_by text,
    owed_at timestamp with time zone,
    CONSTRAINT budget_state_held_reason_check CHECK ((held_reason = ANY (ARRAY['429'::text, '5xx'::text, 'owner'::text]))),
    CONSTRAINT budget_state_owed_by_check CHECK (((owed_by IS NULL) OR (owed_by ~ '^[a-z][a-z0-9_]{0,31}$'::text))),
    CONSTRAINT budget_state_owed_pair CHECK (((owed_by IS NULL) = (owed_at IS NULL)))
)
WITH (fillfactor='50');

CREATE TABLE control.budgets (
    budget_key text NOT NULL,
    window_s integer NOT NULL,
    licence_max integer NOT NULL,
    licence_source text NOT NULL,
    ceiling integer NOT NULL,
    burst_window_s integer,
    burst_licence_max integer,
    burst_max integer,
    spacing_licence_ms integer,
    spacing_ms integer,
    hold_s integer DEFAULT 0 NOT NULL,
    reserve_pct numeric(4,3) DEFAULT 0 NOT NULL,
    CONSTRAINT budgets_budget_key_check CHECK ((budget_key ~ '^[a-z][a-z0-9_]{0,63}$'::text)),
    CONSTRAINT budgets_burst_group CHECK ((((burst_window_s IS NULL) AND (burst_licence_max IS NULL) AND (burst_max IS NULL)) OR ((burst_window_s IS NOT NULL) AND (burst_licence_max IS NOT NULL) AND (burst_max IS NOT NULL)))),
    CONSTRAINT budgets_burst_licence CHECK (((burst_max IS NULL) OR ((burst_window_s >= 1) AND (burst_window_s < window_s) AND (burst_licence_max >= 1) AND ((burst_max >= 0) AND (burst_max <= burst_licence_max))))),
    CONSTRAINT budgets_ceiling_licence CHECK (((ceiling >= 0) AND (ceiling <= licence_max))),
    CONSTRAINT budgets_hold_s_check CHECK (((hold_s >= 0) AND (hold_s <= 3600))),
    CONSTRAINT budgets_licence_max_check CHECK ((licence_max >= 1)),
    CONSTRAINT budgets_licence_source_check CHECK (((length(licence_source) >= 3) AND (length(licence_source) <= 300))),
    CONSTRAINT budgets_reserve_pct_check CHECK (((reserve_pct >= (0)::numeric) AND (reserve_pct < 0.5))),
    CONSTRAINT budgets_spacing_group CHECK (((spacing_licence_ms IS NULL) = (spacing_ms IS NULL))),
    CONSTRAINT budgets_spacing_licence CHECK (((spacing_ms IS NULL) OR ((spacing_licence_ms >= 1) AND (spacing_ms >= spacing_licence_ms) AND (spacing_ms <= 3600000)))),
    CONSTRAINT budgets_window_s_check CHECK (((window_s >= 1) AND (window_s <= 86400)))
);

CREATE TABLE control.callers (
    caller text NOT NULL,
    process text NOT NULL,
    person boolean NOT NULL,
    purpose text NOT NULL,
    CONSTRAINT callers_caller_check CHECK ((caller ~ '^[a-z][a-z0-9_]{0,31}$'::text)),
    CONSTRAINT callers_process_check CHECK ((process = ANY (ARRAY['worker'::text, 'mcp'::text, 'cli'::text]))),
    CONSTRAINT callers_purpose_check CHECK (((length(purpose) >= 3) AND (length(purpose) <= 200)))
);

CREATE TABLE control.changes (
    id bigint NOT NULL,
    at timestamp with time zone NOT NULL,
    actor text NOT NULL,
    reason text NOT NULL,
    tbl text NOT NULL,
    budget_key text,
    caller text,
    field text NOT NULL,
    before text,
    after text
);

ALTER TABLE control.changes ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME control.changes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE control.feed_state (
    ledger text NOT NULL,
    key text NOT NULL,
    budget_key text,
    cadence_s integer,
    next_due_at timestamp with time zone,
    last_attempt_at timestamp with time zone,
    last_attempt_status text,
    last_success_at timestamp with time zone,
    last_changed_at timestamp with time zone,
    last_refusal_at timestamp with time zone,
    last_refusal text,
    refused_since timestamp with time zone,
    updated_at timestamp with time zone NOT NULL,
    CONSTRAINT feed_state_ledger_check CHECK ((ledger = ANY (ARRAY['feed'::text, 'ingest'::text])))
);

CREATE TABLE control.refusals (
    id bigint NOT NULL,
    at timestamp with time zone NOT NULL,
    budget_key text NOT NULL,
    provider text NOT NULL,
    caller text NOT NULL,
    subject text,
    outcome text NOT NULL,
    wait_ms integer,
    CONSTRAINT refusals_budget_key_check CHECK ((budget_key ~ '^[a-z][a-z0-9_]{0,63}$'::text)),
    CONSTRAINT refusals_caller_check CHECK ((caller ~ '^[a-z][a-z0-9_]{0,31}$'::text)),
    CONSTRAINT refusals_outcome_check CHECK ((outcome = ANY (ARRAY['ceiling'::text, 'share'::text, 'reserved'::text, 'burst'::text, 'spacing'::text, 'yield'::text, 'hold'::text, 'no-budget'::text, 'no-share'::text]))),
    CONSTRAINT refusals_provider_check CHECK ((provider ~ '^[a-z][a-z0-9_]{0,63}$'::text)),
    CONSTRAINT refusals_subject_check CHECK (((subject IS NULL) OR ((length(subject) >= 1) AND (length(subject) <= 200)))),
    CONSTRAINT refusals_wait_ms_check CHECK (((wait_ms IS NULL) OR (wait_ms >= 0)))
);

CREATE TABLE public.feed_catalog (
    feed_key text NOT NULL,
    provider text NOT NULL,
    display_name text NOT NULL,
    offer_id text,
    offer_url text,
    licence_id text NOT NULL,
    licence_label text,
    attribution text,
    subscription_var text,
    format text,
    profile text,
    cadence_s integer,
    min_interval_s integer,
    enabled boolean DEFAULT false NOT NULL,
    registry_version text,
    updated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    closed_at timestamp with time zone,
    published_by text,
    declared_cadence_s integer,
    listed_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT feed_catalog_cadence_s_check CHECK (((cadence_s IS NULL) OR (cadence_s > 0))),
    CONSTRAINT feed_catalog_declared_cadence_s_check CHECK (((declared_cadence_s IS NULL) OR (declared_cadence_s > 0))),
    CONSTRAINT feed_catalog_min_interval_s_check CHECK (((min_interval_s IS NULL) OR (min_interval_s > 0))),
    CONSTRAINT feed_catalog_offer_id_is_public CHECK (((offer_id IS NULL) OR (offer_id ~ '^-?[0-9]{1,19}$'::text))),
    CONSTRAINT feed_catalog_published_by_check CHECK (((published_by IS NULL) OR (btrim(published_by) <> ''::text))),
    CONSTRAINT feed_catalog_subscription_var_is_a_name CHECK (((subscription_var IS NULL) OR (subscription_var ~ '^[A-Z][A-Z0-9_]*$'::text)))
);

CREATE TABLE public.runtime_config (
    key text NOT NULL,
    value text NOT NULL,
    changed_by text NOT NULL,
    changed_at timestamp with time zone DEFAULT now() NOT NULL,
    reason text NOT NULL,
    CONSTRAINT runtime_config_bounds CHECK (
CASE
    WHEN (value !~ '^[0-9]{1,6}$'::text) THEN ((key ~~ '%.paused'::text) AND (value = ANY (ARRAY['true'::text, 'false'::text])))
    WHEN (key = 'tankerkoenig.interval_s'::text) THEN (((value)::integer >= 300) AND ((value)::integer <= 3600))
    WHEN (key = 'fuel.cache_fresh_s'::text) THEN (((value)::integer >= 300) AND ((value)::integer <= 21600))
    WHEN (key = 'fuel.rediscover_days'::text) THEN (((value)::integer >= 1) AND ((value)::integer <= 365))
    WHEN (key = 'fuel.ask_radius_km'::text) THEN (((value)::integer >= 5) AND ((value)::integer <= 25))
    WHEN (key = 'fuel.ask_ids'::text) THEN (((value)::integer >= 1) AND ((value)::integer <= 10))
    WHEN (key = 'fuel.ask_deadline_ms'::text) THEN (((value)::integer >= 500) AND ((value)::integer <= 10000))
    WHEN (key = 'fuel.detail_every_s'::text) THEN (((value)::integer >= 300) AND ((value)::integer <= 86400))
    WHEN (key = 'fuel.wide_stations_per_day'::text) THEN (((value)::integer >= 0) AND ((value)::integer <= 2000))
    WHEN (key = 'ui.card_page_size'::text) THEN (((value)::integer >= 3) AND ((value)::integer <= 50))
    WHEN (key ~~ 'mobilithek.%.interval_s'::text) THEN ((value)::integer >= 60)
    WHEN (key ~~ 'source.%.interval_s'::text) THEN ((value)::integer >= 60)
    ELSE false
END),
    CONSTRAINT runtime_config_changed_by_check CHECK ((changed_by ~ '^[a-z][a-z0-9_-]{0,31}$'::text)),
    CONSTRAINT runtime_config_key_check CHECK ((key ~ '^(mobilithek\.[a-z][a-z0-9_]{0,63}\.(interval_s|paused)|tankerkoenig\.interval_s|fuel\.(cache_fresh_s|rediscover_days|ask_radius_km|ask_ids|ask_deadline_ms|detail_every_s|wide_stations_per_day)|source\.[a-z][a-z0-9_]{0,63}\.(paused|interval_s)|ui\.card_page_size)$'::text)),
    CONSTRAINT runtime_config_reason_check CHECK (((length(reason) >= 3) AND (length(reason) <= 200))),
    CONSTRAINT runtime_config_value_check CHECK ((value ~ '^([0-9]{1,6}|true|false)$'::text))
);

CREATE TABLE public.source_schedule (
    source_key text NOT NULL,
    host text NOT NULL,
    state text DEFAULT 'unknown'::text NOT NULL,
    next_due_at timestamp with time zone,
    last_started_at timestamp with time zone,
    last_finished_at timestamp with time zone,
    last_request_at timestamp with time zone,
    last_status text,
    last_result text,
    declared_cadence_s integer NOT NULL,
    granted_cadence_s integer NOT NULL,
    floor_s integer NOT NULL,
    grant_reason text,
    running_since timestamp with time zone,
    heartbeat_at timestamp with time zone,
    lateness_ms bigint,
    paused_by text,
    paused_at timestamp with time zone,
    paused_reason text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT source_schedule_declared_cadence_s_check CHECK ((declared_cadence_s > 0)),
    CONSTRAINT source_schedule_floor_s_check CHECK ((floor_s >= 0)),
    CONSTRAINT source_schedule_grant_reason_check CHECK (((grant_reason IS NULL) OR (length(grant_reason) <= 200))),
    CONSTRAINT source_schedule_granted_cadence_s_check CHECK ((granted_cadence_s > 0)),
    CONSTRAINT source_schedule_granted_floor CHECK ((granted_cadence_s >= floor_s)),
    CONSTRAINT source_schedule_host_check CHECK ((host = ANY (ARRAY['ingest-autobahn'::text, 'ingest-tankerkoenig'::text, 'ingest-mobilithek'::text, 'ingest-dwd'::text, 'ingest-vbb-rt'::text, 'ingest-db-fasta'::text, 'ingest-gtfs-roll'::text, 'ingest-gtfs-fetch'::text, 'ingest-zhv'::text, 'ingest-bnetza'::text, 'ingest-ocpdb'::text, 'ingest-hamburg'::text, 'ingest-gbfs'::text, 'retention'::text]))),
    CONSTRAINT source_schedule_last_result_check CHECK (((last_result IS NULL) OR (length(last_result) <= 200))),
    CONSTRAINT source_schedule_last_status_check CHECK ((last_status = ANY (ARRAY['ok'::text, 'unchanged'::text, 'pending'::text, 'held'::text, 'skipped'::text, 'degraded'::text, 'error'::text, 'running'::text, 'interrupted'::text]))),
    CONSTRAINT source_schedule_lateness_ms_check CHECK (((lateness_ms IS NULL) OR (lateness_ms >= 0))),
    CONSTRAINT source_schedule_paused CHECK (((state <> 'paused'::text) OR ((paused_by IS NOT NULL) AND (paused_at IS NOT NULL)))),
    CONSTRAINT source_schedule_paused_by_check CHECK (((paused_by IS NULL) OR (paused_by ~ '^[a-z][a-z0-9_-]{0,31}$'::text))),
    CONSTRAINT source_schedule_paused_reason_check CHECK (((paused_reason IS NULL) OR ((length(paused_reason) >= 3) AND (length(paused_reason) <= 200)))),
    CONSTRAINT source_schedule_running CHECK (((state = 'running'::text) = (running_since IS NOT NULL))),
    CONSTRAINT source_schedule_source_key_check CHECK ((source_key ~ '^[a-z][a-z0-9_]{0,63}$'::text)),
    CONSTRAINT source_schedule_state_check CHECK ((state = ANY (ARRAY['active'::text, 'paused'::text, 'misconfigured'::text, 'running'::text, 'unknown'::text])))
);

CREATE VIEW control.data_status AS
 SELECT fs.ledger,
    fs.key,
    fs.budget_key,
    COALESCE(c.cadence_s, fs.cadence_s) AS cadence_s,
    fs.next_due_at,
    fs.last_success_at AS held_since,
    (EXTRACT(epoch FROM (now() - fs.last_success_at)))::bigint AS held_age_s,
    fs.last_changed_at,
    (pr.reason IS NOT NULL) AS paused,
    pr.reason AS pause_reason,
        CASE
            WHEN (pr.reason = 'budget'::text) THEN fs.last_refusal
            ELSE NULL::text
        END AS budget_hit,
        CASE pr.reason
            WHEN 'owner'::text THEN pr.owner_since
            WHEN 'hold'::text THEN (bs.held_until - make_interval(secs => (b.hold_s)::double precision))
            WHEN 'budget'::text THEN fs.refused_since
            ELSE NULL::timestamp with time zone
        END AS paused_since,
        CASE pr.reason
            WHEN 'hold'::text THEN bs.held_until
            WHEN 'budget'::text THEN COALESCE(( SELECT (r.at + make_interval(secs => (((COALESCE(r.wait_ms, 0))::numeric / 1000.0))::double precision))
               FROM control.refusals r
              WHERE (r.subject = fs.key)
              ORDER BY r.at DESC
             LIMIT 1), ( SELECT (r.at + make_interval(secs => (((COALESCE(r.wait_ms, 0))::numeric / 1000.0))::double precision))
               FROM control.refusals r
              WHERE (r.budget_key = fs.budget_key)
              ORDER BY r.at DESC
             LIMIT 1))
            ELSE NULL::timestamp with time zone
        END AS resumes_at,
    ((pr.reason IS NULL) AND (fs.last_success_at IS NOT NULL) AND (COALESCE(c.cadence_s, fs.cadence_s) IS NOT NULL) AND ((now() - fs.last_success_at) > make_interval(secs => ((3 * COALESCE(c.cadence_s, fs.cadence_s)))::double precision))) AS stale
   FROM ((((control.feed_state fs
     LEFT JOIN public.feed_catalog c ON (((fs.ledger = 'feed'::text) AND (c.feed_key = fs.key))))
     LEFT JOIN control.budget_state bs ON ((bs.budget_key = fs.budget_key)))
     LEFT JOIN control.budgets b ON ((b.budget_key = fs.budget_key)))
     CROSS JOIN LATERAL ( SELECT o.since AS owner_since,
                CASE
                    WHEN (o.since IS NOT NULL) THEN 'owner'::text
                    WHEN (bs.held_until > now()) THEN 'hold'::text
                    WHEN (fs.refused_since IS NOT NULL) THEN 'budget'::text
                    ELSE NULL::text
                END AS reason
           FROM ( SELECT COALESCE(( SELECT ss.paused_at
                           FROM public.source_schedule ss
                          WHERE ((ss.source_key = fs.key) AND (ss.state = 'paused'::text))
                          ORDER BY ss.paused_at
                         LIMIT 1), ( SELECT rc.changed_at
                           FROM public.runtime_config rc
                          WHERE ((rc.key = ANY (ARRAY[(('source.'::text || fs.key) || '.paused'::text), (('mobilithek.'::text || fs.key) || '.paused'::text)])) AND (rc.value = 'true'::text))
                          ORDER BY rc.changed_at
                         LIMIT 1)) AS since) o) pr);

CREATE TABLE control.providers (
    provider text NOT NULL,
    budget_key text NOT NULL,
    min_interval_ms integer NOT NULL,
    max_concurrent smallint NOT NULL,
    CONSTRAINT providers_max_concurrent_check CHECK (((max_concurrent >= 1) AND (max_concurrent <= 8))),
    CONSTRAINT providers_min_interval_ms_check CHECK ((min_interval_ms >= 1)),
    CONSTRAINT providers_provider_check CHECK ((provider ~ '^[a-z][a-z0-9_]{0,63}$'::text))
);

ALTER TABLE control.refusals ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME control.refusals_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE control.shares (
    budget_key text NOT NULL,
    caller text NOT NULL,
    floor integer NOT NULL,
    cap integer NOT NULL,
    CONSTRAINT shares_floor_cap CHECK ((floor <= cap)),
    CONSTRAINT shares_floor_check CHECK ((floor >= 0))
);

CREATE TABLE control.usage (
    budget_key text NOT NULL,
    caller text NOT NULL,
    bucket_start timestamp with time zone NOT NULL,
    admitted integer NOT NULL,
    not_sent integer DEFAULT 0 NOT NULL,
    CONSTRAINT usage_admitted_check CHECK ((admitted > 0)),
    CONSTRAINT usage_not_sent CHECK (((not_sent >= 0) AND (not_sent <= admitted)))
)
WITH (fillfactor='70');

CREATE TABLE control.usage_hourly (
    hour timestamp with time zone NOT NULL,
    budget_key text NOT NULL,
    caller text NOT NULL,
    admitted integer DEFAULT 0 NOT NULL,
    not_sent integer DEFAULT 0 NOT NULL,
    refused_ceiling integer DEFAULT 0 NOT NULL,
    refused_share integer DEFAULT 0 NOT NULL,
    refused_reserved integer DEFAULT 0 NOT NULL,
    refused_burst integer DEFAULT 0 NOT NULL,
    refused_spacing integer DEFAULT 0 NOT NULL,
    refused_yield integer DEFAULT 0 NOT NULL,
    refused_hold integer DEFAULT 0 NOT NULL,
    refused_unconfigured integer DEFAULT 0 NOT NULL,
    first_refused_at timestamp with time zone,
    last_refused_at timestamp with time zone,
    ceiling_at integer,
    cap_at integer,
    floor_at integer,
    computed_at timestamp with time zone NOT NULL
);

CREATE TABLE domains.road_works (
    id bigint NOT NULL,
    source_id text NOT NULL,
    feed text DEFAULT 'default'::text NOT NULL,
    external_id text NOT NULL,
    match_key text,
    observed_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    first_seen_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    updated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    closed_at timestamp with time zone,
    geom public.geometry(Geometry,4326),
    extras jsonb DEFAULT '{}'::jsonb NOT NULL,
    title text,
    description text,
    street text,
    municipality text,
    starts_at timestamp with time zone,
    ends_at timestamp with time zone,
    restriction text,
    CONSTRAINT road_works_external_id_check CHECK ((external_id <> ''::text)),
    CONSTRAINT road_works_source_id_check CHECK ((source_id ~ '^[a-z][a-z0-9_-]{2,62}$'::text))
);

ALTER TABLE ONLY domains.road_works FORCE ROW LEVEL SECURITY;

ALTER TABLE domains.road_works ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME domains.road_works_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE ingestor.sources (
    id text NOT NULL,
    name text NOT NULL,
    domain text NOT NULL,
    feed text DEFAULT 'default'::text NOT NULL,
    provider text NOT NULL,
    unit text,
    config_version text,
    config_sha256 text NOT NULL,
    status text NOT NULL,
    publisher text NOT NULL,
    country text NOT NULL,
    added_in text NOT NULL,
    licence_id text NOT NULL,
    licence_url text,
    attribution text NOT NULL,
    trust smallint DEFAULT 50 NOT NULL,
    schedule jsonb NOT NULL,
    limits jsonb DEFAULT '{}'::jsonb NOT NULL,
    issue integer,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    updated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    registered_by text NOT NULL,
    CONSTRAINT sources_added_in_check CHECK ((added_in ~ '^[0-9]+\.[0-9]+\.[0-9]+$'::text)),
    CONSTRAINT sources_attribution_check CHECK ((btrim(attribution) <> ''::text)),
    CONSTRAINT sources_config_sha256_check CHECK ((config_sha256 ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT sources_country_check CHECK ((country ~ '^[A-Z]{2}$'::text)),
    CONSTRAINT sources_id_check CHECK ((id ~ '^[a-z][a-z0-9_-]{2,62}$'::text)),
    CONSTRAINT sources_licence_id_check CHECK ((btrim(licence_id) <> ''::text)),
    CONSTRAINT sources_status_check CHECK ((status = ANY (ARRAY['enabled'::text, 'disabled'::text]))),
    CONSTRAINT sources_trust_check CHECK (((trust >= 0) AND (trust <= 100)))
);

CREATE VIEW domains.road_works_merged AS
 WITH live AS (
         SELECT r.id,
            r.source_id,
            r.feed,
            r.external_id,
            r.match_key,
            r.observed_at,
            r.first_seen_at,
            r.updated_at,
            r.closed_at,
            r.geom,
            r.extras,
            r.title,
            r.description,
            r.street,
            r.municipality,
            r.starts_at,
            r.ends_at,
            r.restriction,
            COALESCE(r.match_key, ((((r.source_id || '|'::text) || r.feed) || '|'::text) || r.external_id)) AS entity_key,
            s.trust,
            s.attribution,
            s.licence_id
           FROM (domains.road_works r
             LEFT JOIN ingestor.sources s ON ((s.id = r.source_id)))
          WHERE (r.closed_at IS NULL)
        ), ranked AS (
         SELECT l.*::record AS w,
            row_number() OVER (PARTITION BY l.entity_key ORDER BY l.trust DESC NULLS LAST, l.observed_at DESC, (num_nonnulls(l.title, l.description, l.street, l.municipality, l.starts_at, l.ends_at, l.restriction)) DESC, l.source_id, l.external_id) AS rn,
            jsonb_agg(jsonb_build_object('source_id', l.source_id, 'feed', l.feed, 'external_id', l.external_id, 'attribution', l.attribution, 'licence_id', l.licence_id, 'observed_at', l.observed_at)) OVER entity AS sources,
            count(*) OVER entity AS source_count
           FROM live l
          WINDOW entity AS (PARTITION BY l.entity_key ORDER BY l.source_id, l.feed, l.external_id ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING)
        )
 SELECT (w).id AS id,
    (w).source_id AS source_id,
    (w).feed AS feed,
    (w).external_id AS external_id,
    (w).match_key AS match_key,
    (w).observed_at AS observed_at,
    (w).first_seen_at AS first_seen_at,
    (w).updated_at AS updated_at,
    (w).closed_at AS closed_at,
    (w).geom AS geom,
    (w).extras AS extras,
    (w).title AS title,
    (w).description AS description,
    (w).street AS street,
    (w).municipality AS municipality,
    (w).starts_at AS starts_at,
    (w).ends_at AS ends_at,
    (w).restriction AS restriction,
    (w).entity_key AS entity_key,
    (w).trust AS trust,
    (w).attribution AS attribution,
    (w).licence_id AS licence_id,
    sources,
    (source_count)::integer AS source_count
   FROM ranked k
  WHERE (rn = 1);

CREATE TABLE domains.route_recommendations (
    id bigint NOT NULL,
    source_id text NOT NULL,
    feed text DEFAULT 'default'::text NOT NULL,
    external_id text NOT NULL,
    match_key text,
    observed_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    first_seen_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    updated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    closed_at timestamp with time zone,
    geom public.geometry(Geometry,4326),
    extras jsonb DEFAULT '{}'::jsonb NOT NULL,
    situation_id text,
    situation_version text,
    record_type text,
    management_type text,
    recommendation text,
    comment text,
    route jsonb,
    signed boolean,
    severity text,
    validity_status text,
    starts_at timestamp with time zone,
    ends_at timestamp with time zone,
    confidentiality text,
    published_at timestamp with time zone,
    CONSTRAINT route_recommendations_external_id_check CHECK ((external_id <> ''::text)),
    CONSTRAINT route_recommendations_source_id_check CHECK ((source_id ~ '^[a-z][a-z0-9_-]{2,62}$'::text))
);

ALTER TABLE ONLY domains.route_recommendations FORCE ROW LEVEL SECURITY;

ALTER TABLE domains.route_recommendations ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME domains.route_recommendations_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE VIEW domains.route_recommendations_merged AS
 WITH live AS (
         SELECT r.id,
            r.source_id,
            r.feed,
            r.external_id,
            r.match_key,
            r.observed_at,
            r.first_seen_at,
            r.updated_at,
            r.closed_at,
            r.geom,
            r.extras,
            r.situation_id,
            r.situation_version,
            r.record_type,
            r.management_type,
            r.recommendation,
            r.comment,
            r.route,
            r.signed,
            r.severity,
            r.validity_status,
            r.starts_at,
            r.ends_at,
            r.confidentiality,
            r.published_at,
            COALESCE(r.match_key, ((((r.source_id || '|'::text) || r.feed) || '|'::text) || r.external_id)) AS entity_key,
            s.trust,
            s.attribution,
            s.licence_id
           FROM (domains.route_recommendations r
             LEFT JOIN ingestor.sources s ON ((s.id = r.source_id)))
          WHERE (r.closed_at IS NULL)
        ), ranked AS (
         SELECT l.*::record AS w,
            row_number() OVER (PARTITION BY l.entity_key ORDER BY l.trust DESC NULLS LAST, l.observed_at DESC, (num_nonnulls(l.situation_id, l.situation_version, l.record_type, l.management_type, l.recommendation, l.comment, l.route, l.signed, l.severity, l.validity_status, l.starts_at, l.ends_at, l.confidentiality, l.published_at)) DESC, l.source_id, l.external_id) AS rn,
            jsonb_agg(jsonb_build_object('source_id', l.source_id, 'feed', l.feed, 'external_id', l.external_id, 'attribution', l.attribution, 'licence_id', l.licence_id, 'observed_at', l.observed_at)) OVER entity AS sources,
            count(*) OVER entity AS source_count
           FROM live l
          WINDOW entity AS (PARTITION BY l.entity_key ORDER BY l.source_id, l.feed, l.external_id ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING)
        )
 SELECT (w).id AS id,
    (w).source_id AS source_id,
    (w).feed AS feed,
    (w).external_id AS external_id,
    (w).match_key AS match_key,
    (w).observed_at AS observed_at,
    (w).first_seen_at AS first_seen_at,
    (w).updated_at AS updated_at,
    (w).closed_at AS closed_at,
    (w).geom AS geom,
    (w).extras AS extras,
    (w).situation_id AS situation_id,
    (w).situation_version AS situation_version,
    (w).record_type AS record_type,
    (w).management_type AS management_type,
    (w).recommendation AS recommendation,
    (w).comment AS comment,
    (w).route AS route,
    (w).signed AS signed,
    (w).severity AS severity,
    (w).validity_status AS validity_status,
    (w).starts_at AS starts_at,
    (w).ends_at AS ends_at,
    (w).confidentiality AS confidentiality,
    (w).published_at AS published_at,
    (w).entity_key AS entity_key,
    (w).trust AS trust,
    (w).attribution AS attribution,
    (w).licence_id AS licence_id,
    sources,
    (source_count)::integer AS source_count
   FROM ranked k
  WHERE (rn = 1);

CREATE TABLE domains.speed_cameras (
    id bigint NOT NULL,
    source_id text NOT NULL,
    feed text DEFAULT 'default'::text NOT NULL,
    external_id text NOT NULL,
    match_key text,
    observed_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    first_seen_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    updated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    closed_at timestamp with time zone,
    geom public.geometry(Geometry,4326),
    extras jsonb DEFAULT '{}'::jsonb NOT NULL,
    kind text,
    speed_limit integer,
    street text,
    municipality text,
    valid_from timestamp with time zone,
    valid_to timestamp with time zone,
    cases integer,
    CONSTRAINT speed_cameras_external_id_check CHECK ((external_id <> ''::text)),
    CONSTRAINT speed_cameras_source_id_check CHECK ((source_id ~ '^[a-z][a-z0-9_-]{2,62}$'::text))
);

ALTER TABLE ONLY domains.speed_cameras FORCE ROW LEVEL SECURITY;

ALTER TABLE domains.speed_cameras ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME domains.speed_cameras_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE VIEW domains.speed_cameras_merged AS
 WITH live AS (
         SELECT r.id,
            r.source_id,
            r.feed,
            r.external_id,
            r.match_key,
            r.observed_at,
            r.first_seen_at,
            r.updated_at,
            r.closed_at,
            r.geom,
            r.extras,
            r.kind,
            r.speed_limit,
            r.street,
            r.municipality,
            r.valid_from,
            r.valid_to,
            r.cases,
            COALESCE(r.match_key, ((((r.source_id || '|'::text) || r.feed) || '|'::text) || r.external_id)) AS entity_key,
            s.trust,
            s.attribution,
            s.licence_id
           FROM (domains.speed_cameras r
             LEFT JOIN ingestor.sources s ON ((s.id = r.source_id)))
          WHERE (r.closed_at IS NULL)
        ), ranked AS (
         SELECT l.*::record AS w,
            row_number() OVER (PARTITION BY l.entity_key ORDER BY l.trust DESC NULLS LAST, l.observed_at DESC, l.source_id, l.external_id) AS rn,
            jsonb_agg(jsonb_build_object('source_id', l.source_id, 'feed', l.feed, 'external_id', l.external_id, 'attribution', l.attribution, 'licence_id', l.licence_id, 'observed_at', l.observed_at)) OVER entity AS sources,
            count(*) OVER entity AS source_count
           FROM live l
          WINDOW entity AS (PARTITION BY l.entity_key ORDER BY l.source_id, l.feed, l.external_id ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING)
        )
 SELECT (w).id AS id,
    (w).source_id AS source_id,
    (w).feed AS feed,
    (w).external_id AS external_id,
    (w).match_key AS match_key,
    (w).observed_at AS observed_at,
    (w).first_seen_at AS first_seen_at,
    (w).updated_at AS updated_at,
    (w).closed_at AS closed_at,
    (w).geom AS geom,
    (w).extras AS extras,
    (w).kind AS kind,
    (w).speed_limit AS speed_limit,
    (w).street AS street,
    (w).municipality AS municipality,
    (w).valid_from AS valid_from,
    (w).valid_to AS valid_to,
    (w).cases AS cases,
    (w).entity_key AS entity_key,
    (w).trust AS trust,
    (w).attribution AS attribution,
    (w).licence_id AS licence_id,
    sources,
    (source_count)::integer AS source_count
   FROM ranked k
  WHERE (rn = 1);

CREATE TABLE domains.transit_agencies_odbl (
    id bigint NOT NULL,
    source_id text NOT NULL,
    feed text DEFAULT 'default'::text NOT NULL,
    external_id text NOT NULL,
    match_key text,
    observed_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    first_seen_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    updated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    closed_at timestamp with time zone,
    extras jsonb DEFAULT '{}'::jsonb NOT NULL,
    agency_name text,
    agency_url text,
    agency_timezone text,
    agency_lang text,
    feed_version text,
    CONSTRAINT transit_agencies_odbl_external_id_check CHECK ((external_id <> ''::text)),
    CONSTRAINT transit_agencies_odbl_source_id_check CHECK ((source_id ~ '^[a-z][a-z0-9_-]{2,62}$'::text))
);

ALTER TABLE ONLY domains.transit_agencies_odbl FORCE ROW LEVEL SECURITY;

ALTER TABLE domains.transit_agencies_odbl ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME domains.transit_agencies_odbl_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE VIEW domains.transit_agencies_odbl_merged AS
 WITH live AS (
         SELECT r.id,
            r.source_id,
            r.feed,
            r.external_id,
            r.match_key,
            r.observed_at,
            r.first_seen_at,
            r.updated_at,
            r.closed_at,
            r.extras,
            r.agency_name,
            r.agency_url,
            r.agency_timezone,
            r.agency_lang,
            r.feed_version,
            COALESCE(r.match_key, ((((r.source_id || '|'::text) || r.feed) || '|'::text) || r.external_id)) AS entity_key,
            s.trust,
            s.attribution,
            s.licence_id
           FROM (domains.transit_agencies_odbl r
             LEFT JOIN ingestor.sources s ON ((s.id = r.source_id)))
          WHERE (r.closed_at IS NULL)
        ), ranked AS (
         SELECT l.*::record AS w,
            row_number() OVER (PARTITION BY l.entity_key ORDER BY l.trust DESC NULLS LAST, l.observed_at DESC, l.source_id, l.external_id) AS rn,
            jsonb_agg(jsonb_build_object('source_id', l.source_id, 'feed', l.feed, 'external_id', l.external_id, 'attribution', l.attribution, 'licence_id', l.licence_id, 'observed_at', l.observed_at)) OVER entity AS sources,
            count(*) OVER entity AS source_count
           FROM live l
          WINDOW entity AS (PARTITION BY l.entity_key ORDER BY l.source_id, l.feed, l.external_id ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING)
        )
 SELECT (w).id AS id,
    (w).source_id AS source_id,
    (w).feed AS feed,
    (w).external_id AS external_id,
    (w).match_key AS match_key,
    (w).observed_at AS observed_at,
    (w).first_seen_at AS first_seen_at,
    (w).updated_at AS updated_at,
    (w).closed_at AS closed_at,
    (w).extras AS extras,
    (w).agency_name AS agency_name,
    (w).agency_url AS agency_url,
    (w).agency_timezone AS agency_timezone,
    (w).agency_lang AS agency_lang,
    (w).feed_version AS feed_version,
    (w).entity_key AS entity_key,
    (w).trust AS trust,
    (w).attribution AS attribution,
    (w).licence_id AS licence_id,
    sources,
    (source_count)::integer AS source_count
   FROM ranked k
  WHERE (rn = 1);

CREATE TABLE domains.transit_routes_odbl (
    id bigint NOT NULL,
    source_id text NOT NULL,
    feed text DEFAULT 'default'::text NOT NULL,
    external_id text NOT NULL,
    match_key text,
    observed_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    first_seen_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    updated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    closed_at timestamp with time zone,
    extras jsonb DEFAULT '{}'::jsonb NOT NULL,
    agency_id text,
    route_short_name text,
    route_long_name text,
    route_type integer,
    route_color text,
    route_text_color text,
    feed_version text,
    CONSTRAINT transit_routes_odbl_external_id_check CHECK ((external_id <> ''::text)),
    CONSTRAINT transit_routes_odbl_source_id_check CHECK ((source_id ~ '^[a-z][a-z0-9_-]{2,62}$'::text))
);

ALTER TABLE ONLY domains.transit_routes_odbl FORCE ROW LEVEL SECURITY;

ALTER TABLE domains.transit_routes_odbl ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME domains.transit_routes_odbl_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE VIEW domains.transit_routes_odbl_merged AS
 WITH live AS (
         SELECT r.id,
            r.source_id,
            r.feed,
            r.external_id,
            r.match_key,
            r.observed_at,
            r.first_seen_at,
            r.updated_at,
            r.closed_at,
            r.extras,
            r.agency_id,
            r.route_short_name,
            r.route_long_name,
            r.route_type,
            r.route_color,
            r.route_text_color,
            r.feed_version,
            COALESCE(r.match_key, ((((r.source_id || '|'::text) || r.feed) || '|'::text) || r.external_id)) AS entity_key,
            s.trust,
            s.attribution,
            s.licence_id
           FROM (domains.transit_routes_odbl r
             LEFT JOIN ingestor.sources s ON ((s.id = r.source_id)))
          WHERE (r.closed_at IS NULL)
        ), ranked AS (
         SELECT l.*::record AS w,
            row_number() OVER (PARTITION BY l.entity_key ORDER BY l.trust DESC NULLS LAST, l.observed_at DESC, l.source_id, l.external_id) AS rn,
            jsonb_agg(jsonb_build_object('source_id', l.source_id, 'feed', l.feed, 'external_id', l.external_id, 'attribution', l.attribution, 'licence_id', l.licence_id, 'observed_at', l.observed_at)) OVER entity AS sources,
            count(*) OVER entity AS source_count
           FROM live l
          WINDOW entity AS (PARTITION BY l.entity_key ORDER BY l.source_id, l.feed, l.external_id ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING)
        )
 SELECT (w).id AS id,
    (w).source_id AS source_id,
    (w).feed AS feed,
    (w).external_id AS external_id,
    (w).match_key AS match_key,
    (w).observed_at AS observed_at,
    (w).first_seen_at AS first_seen_at,
    (w).updated_at AS updated_at,
    (w).closed_at AS closed_at,
    (w).extras AS extras,
    (w).agency_id AS agency_id,
    (w).route_short_name AS route_short_name,
    (w).route_long_name AS route_long_name,
    (w).route_type AS route_type,
    (w).route_color AS route_color,
    (w).route_text_color AS route_text_color,
    (w).feed_version AS feed_version,
    (w).entity_key AS entity_key,
    (w).trust AS trust,
    (w).attribution AS attribution,
    (w).licence_id AS licence_id,
    sources,
    (source_count)::integer AS source_count
   FROM ranked k
  WHERE (rn = 1);

CREATE TABLE domains.transit_service_dates_odbl (
    id bigint NOT NULL,
    source_id text NOT NULL,
    feed text DEFAULT 'default'::text NOT NULL,
    external_id text NOT NULL,
    match_key text,
    observed_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    first_seen_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    updated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    closed_at timestamp with time zone,
    extras jsonb DEFAULT '{}'::jsonb NOT NULL,
    service_id text,
    service_date date,
    feed_version text,
    CONSTRAINT transit_service_dates_odbl_external_id_check CHECK ((external_id <> ''::text)),
    CONSTRAINT transit_service_dates_odbl_source_id_check CHECK ((source_id ~ '^[a-z][a-z0-9_-]{2,62}$'::text))
);

ALTER TABLE ONLY domains.transit_service_dates_odbl FORCE ROW LEVEL SECURITY;

ALTER TABLE domains.transit_service_dates_odbl ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME domains.transit_service_dates_odbl_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE VIEW domains.transit_service_dates_odbl_merged AS
 WITH live AS (
         SELECT r.id,
            r.source_id,
            r.feed,
            r.external_id,
            r.match_key,
            r.observed_at,
            r.first_seen_at,
            r.updated_at,
            r.closed_at,
            r.extras,
            r.service_id,
            r.service_date,
            r.feed_version,
            COALESCE(r.match_key, ((((r.source_id || '|'::text) || r.feed) || '|'::text) || r.external_id)) AS entity_key,
            s.trust,
            s.attribution,
            s.licence_id
           FROM (domains.transit_service_dates_odbl r
             LEFT JOIN ingestor.sources s ON ((s.id = r.source_id)))
          WHERE (r.closed_at IS NULL)
        ), ranked AS (
         SELECT l.*::record AS w,
            row_number() OVER (PARTITION BY l.entity_key ORDER BY l.trust DESC NULLS LAST, l.observed_at DESC, l.source_id, l.external_id) AS rn,
            jsonb_agg(jsonb_build_object('source_id', l.source_id, 'feed', l.feed, 'external_id', l.external_id, 'attribution', l.attribution, 'licence_id', l.licence_id, 'observed_at', l.observed_at)) OVER entity AS sources,
            count(*) OVER entity AS source_count
           FROM live l
          WINDOW entity AS (PARTITION BY l.entity_key ORDER BY l.source_id, l.feed, l.external_id ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING)
        )
 SELECT (w).id AS id,
    (w).source_id AS source_id,
    (w).feed AS feed,
    (w).external_id AS external_id,
    (w).match_key AS match_key,
    (w).observed_at AS observed_at,
    (w).first_seen_at AS first_seen_at,
    (w).updated_at AS updated_at,
    (w).closed_at AS closed_at,
    (w).extras AS extras,
    (w).service_id AS service_id,
    (w).service_date AS service_date,
    (w).feed_version AS feed_version,
    (w).entity_key AS entity_key,
    (w).trust AS trust,
    (w).attribution AS attribution,
    (w).licence_id AS licence_id,
    sources,
    (source_count)::integer AS source_count
   FROM ranked k
  WHERE (rn = 1);

CREATE TABLE domains.transit_stop_times_odbl (
    id bigint NOT NULL,
    source_id text NOT NULL,
    feed text DEFAULT 'default'::text NOT NULL,
    external_id text NOT NULL,
    match_key text,
    observed_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    first_seen_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    updated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    closed_at timestamp with time zone,
    extras jsonb DEFAULT '{}'::jsonb NOT NULL,
    trip_id text,
    stop_sequence integer,
    stop_id text,
    arrival_s integer,
    departure_s integer,
    stop_headsign text,
    pickup_type integer,
    drop_off_type integer,
    timepoint integer,
    feed_version text,
    CONSTRAINT transit_stop_times_odbl_external_id_check CHECK ((external_id <> ''::text)),
    CONSTRAINT transit_stop_times_odbl_source_id_check CHECK ((source_id ~ '^[a-z][a-z0-9_-]{2,62}$'::text))
);

ALTER TABLE ONLY domains.transit_stop_times_odbl FORCE ROW LEVEL SECURITY;

ALTER TABLE domains.transit_stop_times_odbl ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME domains.transit_stop_times_odbl_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE VIEW domains.transit_stop_times_odbl_merged AS
 WITH live AS (
         SELECT r.id,
            r.source_id,
            r.feed,
            r.external_id,
            r.match_key,
            r.observed_at,
            r.first_seen_at,
            r.updated_at,
            r.closed_at,
            r.extras,
            r.trip_id,
            r.stop_sequence,
            r.stop_id,
            r.arrival_s,
            r.departure_s,
            r.stop_headsign,
            r.pickup_type,
            r.drop_off_type,
            r.timepoint,
            r.feed_version,
            COALESCE(r.match_key, ((((r.source_id || '|'::text) || r.feed) || '|'::text) || r.external_id)) AS entity_key,
            s.trust,
            s.attribution,
            s.licence_id
           FROM (domains.transit_stop_times_odbl r
             LEFT JOIN ingestor.sources s ON ((s.id = r.source_id)))
          WHERE (r.closed_at IS NULL)
        ), ranked AS (
         SELECT l.*::record AS w,
            row_number() OVER (PARTITION BY l.entity_key ORDER BY l.trust DESC NULLS LAST, l.observed_at DESC, l.source_id, l.external_id) AS rn,
            jsonb_agg(jsonb_build_object('source_id', l.source_id, 'feed', l.feed, 'external_id', l.external_id, 'attribution', l.attribution, 'licence_id', l.licence_id, 'observed_at', l.observed_at)) OVER entity AS sources,
            count(*) OVER entity AS source_count
           FROM live l
          WINDOW entity AS (PARTITION BY l.entity_key ORDER BY l.source_id, l.feed, l.external_id ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING)
        )
 SELECT (w).id AS id,
    (w).source_id AS source_id,
    (w).feed AS feed,
    (w).external_id AS external_id,
    (w).match_key AS match_key,
    (w).observed_at AS observed_at,
    (w).first_seen_at AS first_seen_at,
    (w).updated_at AS updated_at,
    (w).closed_at AS closed_at,
    (w).extras AS extras,
    (w).trip_id AS trip_id,
    (w).stop_sequence AS stop_sequence,
    (w).stop_id AS stop_id,
    (w).arrival_s AS arrival_s,
    (w).departure_s AS departure_s,
    (w).stop_headsign AS stop_headsign,
    (w).pickup_type AS pickup_type,
    (w).drop_off_type AS drop_off_type,
    (w).timepoint AS timepoint,
    (w).feed_version AS feed_version,
    (w).entity_key AS entity_key,
    (w).trust AS trust,
    (w).attribution AS attribution,
    (w).licence_id AS licence_id,
    sources,
    (source_count)::integer AS source_count
   FROM ranked k
  WHERE (rn = 1);

CREATE TABLE domains.transit_stops_odbl (
    id bigint NOT NULL,
    source_id text NOT NULL,
    feed text DEFAULT 'default'::text NOT NULL,
    external_id text NOT NULL,
    match_key text,
    observed_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    first_seen_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    updated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    closed_at timestamp with time zone,
    geom public.geometry(Geometry,4326),
    extras jsonb DEFAULT '{}'::jsonb NOT NULL,
    stop_name text,
    stop_code text,
    location_type integer,
    parent_station text,
    stop_timezone text,
    platform_code text,
    wheelchair_boarding integer,
    feed_version text,
    CONSTRAINT transit_stops_odbl_external_id_check CHECK ((external_id <> ''::text)),
    CONSTRAINT transit_stops_odbl_source_id_check CHECK ((source_id ~ '^[a-z][a-z0-9_-]{2,62}$'::text))
);

ALTER TABLE ONLY domains.transit_stops_odbl FORCE ROW LEVEL SECURITY;

ALTER TABLE domains.transit_stops_odbl ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME domains.transit_stops_odbl_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE VIEW domains.transit_stops_odbl_merged AS
 WITH live AS (
         SELECT r.id,
            r.source_id,
            r.feed,
            r.external_id,
            r.match_key,
            r.observed_at,
            r.first_seen_at,
            r.updated_at,
            r.closed_at,
            r.geom,
            r.extras,
            r.stop_name,
            r.stop_code,
            r.location_type,
            r.parent_station,
            r.stop_timezone,
            r.platform_code,
            r.wheelchair_boarding,
            r.feed_version,
            COALESCE(r.match_key, ((((r.source_id || '|'::text) || r.feed) || '|'::text) || r.external_id)) AS entity_key,
            s.trust,
            s.attribution,
            s.licence_id
           FROM (domains.transit_stops_odbl r
             LEFT JOIN ingestor.sources s ON ((s.id = r.source_id)))
          WHERE (r.closed_at IS NULL)
        ), ranked AS (
         SELECT l.*::record AS w,
            row_number() OVER (PARTITION BY l.entity_key ORDER BY l.trust DESC NULLS LAST, l.observed_at DESC, l.source_id, l.external_id) AS rn,
            jsonb_agg(jsonb_build_object('source_id', l.source_id, 'feed', l.feed, 'external_id', l.external_id, 'attribution', l.attribution, 'licence_id', l.licence_id, 'observed_at', l.observed_at)) OVER entity AS sources,
            count(*) OVER entity AS source_count
           FROM live l
          WINDOW entity AS (PARTITION BY l.entity_key ORDER BY l.source_id, l.feed, l.external_id ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING)
        )
 SELECT (w).id AS id,
    (w).source_id AS source_id,
    (w).feed AS feed,
    (w).external_id AS external_id,
    (w).match_key AS match_key,
    (w).observed_at AS observed_at,
    (w).first_seen_at AS first_seen_at,
    (w).updated_at AS updated_at,
    (w).closed_at AS closed_at,
    (w).geom AS geom,
    (w).extras AS extras,
    (w).stop_name AS stop_name,
    (w).stop_code AS stop_code,
    (w).location_type AS location_type,
    (w).parent_station AS parent_station,
    (w).stop_timezone AS stop_timezone,
    (w).platform_code AS platform_code,
    (w).wheelchair_boarding AS wheelchair_boarding,
    (w).feed_version AS feed_version,
    (w).entity_key AS entity_key,
    (w).trust AS trust,
    (w).attribution AS attribution,
    (w).licence_id AS licence_id,
    sources,
    (source_count)::integer AS source_count
   FROM ranked k
  WHERE (rn = 1);

CREATE TABLE domains.transit_trip_updates_odbl (
    id bigint NOT NULL,
    source_id text NOT NULL,
    feed text DEFAULT 'default'::text NOT NULL,
    external_id text NOT NULL,
    match_key text,
    observed_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    first_seen_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    updated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    closed_at timestamp with time zone,
    extras jsonb DEFAULT '{}'::jsonb NOT NULL,
    entity_id text,
    trip_id text,
    route_id text,
    start_date date,
    start_time text,
    direction_id integer,
    trip_relationship text,
    vehicle_id text,
    trip_delay_s integer,
    stop_sequence integer,
    stop_id text,
    stop_relationship text,
    arrival_delay_s integer,
    arrival_at timestamp with time zone,
    departure_delay_s integer,
    departure_at timestamp with time zone,
    CONSTRAINT transit_trip_updates_odbl_external_id_check CHECK ((external_id <> ''::text)),
    CONSTRAINT transit_trip_updates_odbl_source_id_check CHECK ((source_id ~ '^[a-z][a-z0-9_-]{2,62}$'::text))
);

ALTER TABLE ONLY domains.transit_trip_updates_odbl FORCE ROW LEVEL SECURITY;

ALTER TABLE domains.transit_trip_updates_odbl ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME domains.transit_trip_updates_odbl_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE VIEW domains.transit_trip_updates_odbl_merged AS
 WITH live AS (
         SELECT r.id,
            r.source_id,
            r.feed,
            r.external_id,
            r.match_key,
            r.observed_at,
            r.first_seen_at,
            r.updated_at,
            r.closed_at,
            r.extras,
            r.entity_id,
            r.trip_id,
            r.route_id,
            r.start_date,
            r.start_time,
            r.direction_id,
            r.trip_relationship,
            r.vehicle_id,
            r.trip_delay_s,
            r.stop_sequence,
            r.stop_id,
            r.stop_relationship,
            r.arrival_delay_s,
            r.arrival_at,
            r.departure_delay_s,
            r.departure_at,
            COALESCE(r.match_key, ((((r.source_id || '|'::text) || r.feed) || '|'::text) || r.external_id)) AS entity_key,
            s.trust,
            s.attribution,
            s.licence_id
           FROM (domains.transit_trip_updates_odbl r
             LEFT JOIN ingestor.sources s ON ((s.id = r.source_id)))
          WHERE (r.closed_at IS NULL)
        ), ranked AS (
         SELECT l.*::record AS w,
            row_number() OVER (PARTITION BY l.entity_key ORDER BY l.trust DESC NULLS LAST, l.observed_at DESC, l.source_id, l.external_id) AS rn,
            jsonb_agg(jsonb_build_object('source_id', l.source_id, 'feed', l.feed, 'external_id', l.external_id, 'attribution', l.attribution, 'licence_id', l.licence_id, 'observed_at', l.observed_at)) OVER entity AS sources,
            count(*) OVER entity AS source_count
           FROM live l
          WINDOW entity AS (PARTITION BY l.entity_key ORDER BY l.source_id, l.feed, l.external_id ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING)
        )
 SELECT (w).id AS id,
    (w).source_id AS source_id,
    (w).feed AS feed,
    (w).external_id AS external_id,
    (w).match_key AS match_key,
    (w).observed_at AS observed_at,
    (w).first_seen_at AS first_seen_at,
    (w).updated_at AS updated_at,
    (w).closed_at AS closed_at,
    (w).extras AS extras,
    (w).entity_id AS entity_id,
    (w).trip_id AS trip_id,
    (w).route_id AS route_id,
    (w).start_date AS start_date,
    (w).start_time AS start_time,
    (w).direction_id AS direction_id,
    (w).trip_relationship AS trip_relationship,
    (w).vehicle_id AS vehicle_id,
    (w).trip_delay_s AS trip_delay_s,
    (w).stop_sequence AS stop_sequence,
    (w).stop_id AS stop_id,
    (w).stop_relationship AS stop_relationship,
    (w).arrival_delay_s AS arrival_delay_s,
    (w).arrival_at AS arrival_at,
    (w).departure_delay_s AS departure_delay_s,
    (w).departure_at AS departure_at,
    (w).entity_key AS entity_key,
    (w).trust AS trust,
    (w).attribution AS attribution,
    (w).licence_id AS licence_id,
    sources,
    (source_count)::integer AS source_count
   FROM ranked k
  WHERE (rn = 1);

CREATE TABLE domains.transit_trips_odbl (
    id bigint NOT NULL,
    source_id text NOT NULL,
    feed text DEFAULT 'default'::text NOT NULL,
    external_id text NOT NULL,
    match_key text,
    observed_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    first_seen_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    updated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    closed_at timestamp with time zone,
    extras jsonb DEFAULT '{}'::jsonb NOT NULL,
    route_id text,
    service_id text,
    trip_headsign text,
    trip_short_name text,
    direction_id integer,
    shape_id text,
    wheelchair_accessible integer,
    bikes_allowed integer,
    feed_version text,
    CONSTRAINT transit_trips_odbl_external_id_check CHECK ((external_id <> ''::text)),
    CONSTRAINT transit_trips_odbl_source_id_check CHECK ((source_id ~ '^[a-z][a-z0-9_-]{2,62}$'::text))
);

ALTER TABLE ONLY domains.transit_trips_odbl FORCE ROW LEVEL SECURITY;

ALTER TABLE domains.transit_trips_odbl ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME domains.transit_trips_odbl_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE VIEW domains.transit_trips_odbl_merged AS
 WITH live AS (
         SELECT r.id,
            r.source_id,
            r.feed,
            r.external_id,
            r.match_key,
            r.observed_at,
            r.first_seen_at,
            r.updated_at,
            r.closed_at,
            r.extras,
            r.route_id,
            r.service_id,
            r.trip_headsign,
            r.trip_short_name,
            r.direction_id,
            r.shape_id,
            r.wheelchair_accessible,
            r.bikes_allowed,
            r.feed_version,
            COALESCE(r.match_key, ((((r.source_id || '|'::text) || r.feed) || '|'::text) || r.external_id)) AS entity_key,
            s.trust,
            s.attribution,
            s.licence_id
           FROM (domains.transit_trips_odbl r
             LEFT JOIN ingestor.sources s ON ((s.id = r.source_id)))
          WHERE (r.closed_at IS NULL)
        ), ranked AS (
         SELECT l.*::record AS w,
            row_number() OVER (PARTITION BY l.entity_key ORDER BY l.trust DESC NULLS LAST, l.observed_at DESC, l.source_id, l.external_id) AS rn,
            jsonb_agg(jsonb_build_object('source_id', l.source_id, 'feed', l.feed, 'external_id', l.external_id, 'attribution', l.attribution, 'licence_id', l.licence_id, 'observed_at', l.observed_at)) OVER entity AS sources,
            count(*) OVER entity AS source_count
           FROM live l
          WINDOW entity AS (PARTITION BY l.entity_key ORDER BY l.source_id, l.feed, l.external_id ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING)
        )
 SELECT (w).id AS id,
    (w).source_id AS source_id,
    (w).feed AS feed,
    (w).external_id AS external_id,
    (w).match_key AS match_key,
    (w).observed_at AS observed_at,
    (w).first_seen_at AS first_seen_at,
    (w).updated_at AS updated_at,
    (w).closed_at AS closed_at,
    (w).extras AS extras,
    (w).route_id AS route_id,
    (w).service_id AS service_id,
    (w).trip_headsign AS trip_headsign,
    (w).trip_short_name AS trip_short_name,
    (w).direction_id AS direction_id,
    (w).shape_id AS shape_id,
    (w).wheelchair_accessible AS wheelchair_accessible,
    (w).bikes_allowed AS bikes_allowed,
    (w).feed_version AS feed_version,
    (w).entity_key AS entity_key,
    (w).trust AS trust,
    (w).attribution AS attribution,
    (w).licence_id AS licence_id,
    sources,
    (source_count)::integer AS source_count
   FROM ranked k
  WHERE (rn = 1);

CREATE TABLE ingestor.limit_claims (
    limit_key text NOT NULL,
    min_interval_ms integer NOT NULL,
    per_hour integer,
    per_day integer,
    last_start_at timestamp with time zone,
    starts timestamp with time zone[] DEFAULT '{}'::timestamp with time zone[] NOT NULL,
    claims_total bigint DEFAULT 0 NOT NULL,
    CONSTRAINT limit_claims_limit_key_check CHECK ((limit_key ~ '^(provider|source):[A-Za-z0-9_:-]+$'::text)),
    CONSTRAINT limit_claims_min_interval_ms_check CHECK ((min_interval_ms >= 0)),
    CONSTRAINT limit_claims_per_day_check CHECK ((per_day > 0)),
    CONSTRAINT limit_claims_per_hour_check CHECK ((per_hour > 0))
);

CREATE TABLE ingestor.run_errors (
    id bigint NOT NULL,
    run_id bigint NOT NULL,
    source_id text NOT NULL,
    at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    stage text NOT NULL,
    field text,
    reason text NOT NULL,
    sample jsonb,
    CONSTRAINT run_errors_reason_check CHECK ((length(reason) <= 1000)),
    CONSTRAINT run_errors_sample_check CHECK ((octet_length((sample)::text) <= 4096)),
    CONSTRAINT run_errors_stage_check CHECK ((stage = ANY (ARRAY['config'::text, 'limit'::text, 'fetch'::text, 'decode'::text, 'extract'::text, 'transform'::text, 'validate'::text, 'write'::text, 'ledger'::text, 'run'::text])))
);

ALTER TABLE ingestor.run_errors ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME ingestor.run_errors_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE ingestor.runs (
    id bigint NOT NULL,
    source_id text NOT NULL,
    unit text,
    pod text,
    config_sha256 text,
    scheduled_at timestamp with time zone,
    started_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    finished_at timestamp with time zone,
    duration_ms integer,
    status text NOT NULL,
    fetched integer,
    parsed integer,
    inserted integer,
    updated integer,
    closed integer,
    rejected integer,
    requests integer,
    bytes bigint,
    http_status integer,
    error_class text,
    error_stage text,
    error_message text,
    error_stack text,
    attempt smallint DEFAULT 1 NOT NULL,
    mem_peak_bytes bigint,
    raw_path text,
    projected_at timestamp with time zone,
    CONSTRAINT runs_error_message_check CHECK ((length(error_message) <= 2000)),
    CONSTRAINT runs_error_stack_check CHECK ((length(error_stack) <= 4000)),
    CONSTRAINT runs_status_check CHECK ((status = ANY (ARRAY['running'::text, 'ok'::text, 'unchanged'::text, 'partial'::text, 'error'::text, 'skipped'::text, 'limited'::text])))
);

ALTER TABLE ingestor.runs ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME ingestor.runs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE ingestor.source_state (
    source_id text NOT NULL,
    last_run_id bigint,
    last_status text,
    last_success_at timestamp with time zone,
    last_error_at timestamp with time zone,
    last_error_class text,
    consecutive_failures integer DEFAULT 0 NOT NULL,
    next_due_at timestamp with time zone,
    etag text,
    last_modified text,
    cursor text,
    limit_usage jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

CREATE TABLE ingestor.units (
    name text NOT NULL,
    mode text NOT NULL,
    members text[] NOT NULL,
    config_sha256 text NOT NULL,
    image text,
    git_sha text,
    first_deployed_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    last_deployed_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    last_pod text,
    CONSTRAINT units_config_sha256_check CHECK ((config_sha256 ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT units_members_check CHECK ((cardinality(members) >= 1)),
    CONSTRAINT units_mode_check CHECK ((mode = ANY (ARRAY['cron'::text, 'service'::text, 'stream'::text]))),
    CONSTRAINT units_name_check CHECK ((name ~ '^[a-z][a-z0-9-]{1,40}$'::text))
);

CREATE TABLE public.ags_regions (
    ags text NOT NULL,
    level text NOT NULL,
    name text NOT NULL,
    name_norm text NOT NULL,
    name_en text,
    name_en_norm text,
    parent_ags text,
    geom public.geography(Point,4326),
    source_id text NOT NULL,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    refreshed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ags_regions_code_shape CHECK (((ags ~ '^[0-9]{2}$'::text) OR (ags ~ '^[0-9]{5}$'::text))),
    CONSTRAINT ags_regions_level_matches_code CHECK ((((level = 'land'::text) AND (length(ags) = 2)) OR ((level = 'kreis'::text) AND (length(ags) = 5)))),
    CONSTRAINT ags_regions_name_en_paired CHECK (((name_en IS NULL) = (name_en_norm IS NULL))),
    CONSTRAINT ags_regions_parent_is_prefix CHECK ((((level = 'land'::text) AND (parent_ags IS NULL)) OR ((level = 'kreis'::text) AND (parent_ags = "left"(ags, 2))))),
    CONSTRAINT ags_regions_source_known CHECK ((source_id = ANY (ARRAY['destatis_gv'::text, 'bkg_gvisys'::text])))
);

CREATE TABLE public.alarm_episodes (
    id bigint NOT NULL,
    feed_key text NOT NULL,
    kind text NOT NULL,
    opened_at timestamp with time zone NOT NULL,
    last_seen_at timestamp with time zone NOT NULL,
    cleared_at timestamp with time zone,
    detail text NOT NULL,
    CONSTRAINT alarm_episodes_check CHECK ((last_seen_at >= opened_at)),
    CONSTRAINT alarm_episodes_check1 CHECK (((cleared_at IS NULL) OR (cleared_at >= opened_at)))
);

ALTER TABLE public.alarm_episodes ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.alarm_episodes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.autobahn_event_texts (
    road text NOT NULL,
    title text NOT NULL,
    subtitle text NOT NULL,
    first_seen_at timestamp with time zone NOT NULL,
    last_seen_at timestamp with time zone NOT NULL,
    geom public.geography(Point,4326),
    CONSTRAINT autobahn_event_texts_seen_order CHECK ((last_seen_at >= first_seen_at))
);

CREATE TABLE public.autobahn_events (
    observed_at timestamp with time zone NOT NULL,
    road text NOT NULL,
    kind text NOT NULL,
    ext_id text NOT NULL,
    title text,
    subtitle text,
    abnormal_traffic_type text,
    delay_s integer,
    geom public.geography(Point,4326),
    extent text,
    raw jsonb,
    source text DEFAULT 'autobahn'::text NOT NULL,
    source_run_id bigint,
    raw_hash bytea
)
PARTITION BY RANGE (observed_at);

CREATE TABLE public.autobahn_jam_hours (
    hour_start timestamp with time zone NOT NULL,
    road text NOT NULL,
    jam_titles text[] DEFAULT '{}'::text[] NOT NULL,
    jam_subtitles text[] DEFAULT '{}'::text[] NOT NULL,
    CONSTRAINT autobahn_jam_hours_check CHECK ((cardinality(jam_titles) = cardinality(jam_subtitles))),
    CONSTRAINT autobahn_jam_hours_hour_start_check CHECK (((EXTRACT(epoch FROM hour_start) % (3600)::numeric) = (0)::numeric)),
    CONSTRAINT autobahn_jam_hours_jam_titles_check CHECK ((array_position(jam_titles, NULL::text) IS NULL)),
    CONSTRAINT autobahn_jam_hours_road_check CHECK (((road <> ''::text) AND (length(road) <= 16)))
);

CREATE TABLE public.autobahn_roads (
    road text NOT NULL,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_listed_at timestamp with time zone,
    CONSTRAINT autobahn_roads_listed_order CHECK (((last_listed_at IS NULL) OR ((last_listed_at >= first_seen_at) AND (last_listed_at <= last_seen_at)))),
    CONSTRAINT autobahn_roads_number_shape CHECK ((road ~ '^A[0-9]{1,3}$'::text)),
    CONSTRAINT autobahn_roads_seen_order CHECK ((last_seen_at >= first_seen_at))
);

CREATE TABLE public.bfrk_stops (
    source_feed text NOT NULL,
    source_publisher text NOT NULL,
    dhid text NOT NULL,
    name text NOT NULL,
    municipality text,
    geom public.geography(Point,4326),
    validated boolean,
    collected_by text,
    platforms integer DEFAULT 0 NOT NULL,
    platforms_height_known integer DEFAULT 0 NOT NULL,
    platform_height_min_cm numeric(5,1),
    platform_height_max_cm numeric(5,1),
    platforms_guidance integer DEFAULT 0 NOT NULL,
    lifts integer DEFAULT 0 NOT NULL,
    lift_door_min_cm integer,
    lift_cabin_min_width_cm integer,
    lift_cabin_min_length_cm integer,
    ramps integer DEFAULT 0 NOT NULL,
    ramp_max_slope_pct numeric(5,2),
    stairs integer DEFAULT 0 NOT NULL,
    escalators integer DEFAULT 0 NOT NULL,
    first_seen_at timestamp with time zone NOT NULL,
    last_seen_at timestamp with time zone NOT NULL,
    closed_at timestamp with time zone,
    provider_updated_at timestamp with time zone,
    source_run_id bigint,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    platforms_level_boarding integer DEFAULT 0 NOT NULL,
    platforms_ramp_boarding integer DEFAULT 0 NOT NULL,
    platforms_limited_boarding integer DEFAULT 0 NOT NULL,
    platforms_no_step_free integer DEFAULT 0 NOT NULL,
    step_free text,
    publisher_note text,
    stop_ref text,
    entrances integer DEFAULT 0 NOT NULL,
    entrances_lift integer DEFAULT 0 NOT NULL,
    CONSTRAINT bfrk_stops_boarding CHECK (((platforms_level_boarding >= 0) AND (platforms_ramp_boarding >= 0) AND (platforms_limited_boarding >= 0) AND (platforms_no_step_free >= 0) AND ((((platforms_level_boarding + platforms_ramp_boarding) + platforms_limited_boarding) + platforms_no_step_free) <= platforms))),
    CONSTRAINT bfrk_stops_counts CHECK (((platforms >= 0) AND ((platforms_height_known >= 0) AND (platforms_height_known <= platforms)) AND ((platforms_guidance >= 0) AND (platforms_guidance <= platforms)) AND (lifts >= 0) AND (ramps >= 0) AND (stairs >= 0) AND (escalators >= 0))),
    CONSTRAINT bfrk_stops_entrances CHECK (((entrances >= 0) AND (entrances_lift >= 0) AND (entrances_lift <= entrances))),
    CONSTRAINT bfrk_stops_feed CHECK ((source_feed = ANY (ARRAY['bfrk_spnv'::text, 'bfrk_oepnv'::text, 'dresden_bf_haltestellen'::text, 'muenster_bf_haltestellen'::text, 'vbb_haltestellenzugaenge'::text]))),
    CONSTRAINT bfrk_stops_step_free CHECK (((step_free IS NULL) OR (step_free = ANY (ARRAY['yes'::text, 'partial'::text]))))
);

CREATE VIEW public.bfrk_stops_live AS
 SELECT source_feed,
    dhid,
    name,
    municipality,
    geom,
    validated,
    collected_by,
    platforms,
    platforms_height_known,
    platform_height_min_cm,
    platform_height_max_cm,
    platforms_guidance,
    lifts,
    lift_door_min_cm,
    lift_cabin_min_width_cm,
    lift_cabin_min_length_cm,
    ramps,
    ramp_max_slope_pct,
    stairs,
    escalators,
    provider_updated_at,
    platforms_level_boarding,
    platforms_ramp_boarding,
    platforms_limited_boarding,
    platforms_no_step_free,
    step_free,
    entrances,
    entrances_lift
   FROM public.bfrk_stops s
  WHERE (closed_at IS NULL);

CREATE TABLE public.bw_detours (
    id bigint NOT NULL,
    version_date date NOT NULL,
    source_url text NOT NULL,
    sheet_row integer NOT NULL,
    autobahn text NOT NULL,
    autobahn_raw text NOT NULL,
    direction text,
    extra text,
    u_number text NOT NULL,
    from_junction_no text,
    from_junction text,
    to_junction_no text,
    to_junction text,
    route text,
    raw jsonb DEFAULT '{}'::jsonb NOT NULL,
    first_seen_at timestamp with time zone NOT NULL,
    last_seen_at timestamp with time zone NOT NULL,
    closed_at timestamp with time zone,
    source_feed text NOT NULL,
    source_publisher text NOT NULL,
    source_run_id bigint,
    provider_updated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT bw_detours_autobahn_shape CHECK ((autobahn ~ '^A[0-9]{1,3}$'::text)),
    CONSTRAINT bw_detours_sheet_row_body CHECK ((sheet_row >= 2)),
    CONSTRAINT bw_detours_source_registered CHECK ((source_feed = 'bw_bedarfsumleitungen'::text))
);

ALTER TABLE public.bw_detours ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.bw_detours_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE VIEW public.bw_detours_live AS
 SELECT id,
    version_date,
    autobahn,
    autobahn_raw,
    direction,
    extra,
    u_number,
    from_junction_no,
    from_junction,
    to_junction_no,
    to_junction,
    route,
    last_seen_at,
    source_feed
   FROM public.bw_detours
  WHERE (closed_at IS NULL);

CREATE TABLE public.feed_runs (
    id bigint NOT NULL,
    feed_key text NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    status text NOT NULL,
    http_status integer,
    bytes bigint,
    etag text,
    last_modified text,
    raw_path text,
    items_seen integer,
    items_changed integer,
    error text,
    wire_bytes bigint,
    duration_ms integer,
    body_sha256 text,
    items_inserted integer,
    items_updated integer,
    items_closed integer,
    note text,
    worker_version text,
    next_due_at timestamp with time zone,
    reader_epoch smallint,
    jumped boolean DEFAULT false NOT NULL,
    exchange_protocol text,
    budget_hit text,
    CONSTRAINT feed_runs_status_check CHECK ((status = ANY (ARRAY['ok'::text, 'unchanged'::text, 'pending'::text, 'held'::text, 'skipped'::text, 'degraded'::text, 'error'::text])))
);

CREATE VIEW public.charging_feed_runs_live AS
 SELECT feed_key,
    started_at,
    finished_at,
    status,
    items_seen,
    etag,
    last_modified,
    id,
    jumped,
    exchange_protocol
   FROM public.feed_runs r;

CREATE TABLE public.charging_point_status (
    observed_at timestamp with time zone NOT NULL,
    feed_ts timestamp with time zone,
    last_updated timestamp with time zone,
    evse_id text NOT NULL,
    source_feed text NOT NULL,
    status text,
    operation_status text,
    opening_status text,
    exchange_protocol text,
    site_id text,
    station_id text,
    known_point boolean,
    raw jsonb NOT NULL,
    source_run_id bigint,
    confidentiality text
)
PARTITION BY RANGE (observed_at);

CREATE VIEW public.charging_point_status_live AS
 SELECT evse_id,
    observed_at,
    feed_ts,
    last_updated,
    source_feed,
    status,
    operation_status,
    opening_status,
    exchange_protocol,
    confidentiality,
    source_run_id
   FROM public.charging_point_status t;

CREATE TABLE public.charging_points (
    source_feed text NOT NULL,
    point_key text NOT NULL,
    evse_id text,
    point_key_synthetic boolean DEFAULT false NOT NULL,
    site_id text NOT NULL,
    station_id text,
    provider_point_id text,
    operator text,
    geom public.geography(Point,4326) NOT NULL,
    connector_types text[] DEFAULT '{}'::text[] NOT NULL,
    current_type text,
    max_power_kw numeric(7,2),
    price_per_kwh numeric(6,3),
    price_tax_included boolean,
    price_tax_rate numeric(5,2),
    price_currency text,
    price_last_updated timestamp with time zone,
    source_version text,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    closed_at timestamp with time zone,
    source_publisher text,
    source_run_id bigint,
    provider_updated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    deleted_reason text,
    deleted_run_id bigint,
    confidentiality text,
    extras jsonb,
    price_adhoc_zero boolean
)
WITH (autovacuum_vacuum_scale_factor='0.02');

CREATE VIEW public.charging_points_live AS
 SELECT source_feed,
    point_key,
    evse_id,
    point_key_synthetic,
    site_id,
    station_id,
    provider_point_id,
    operator,
    geom,
    connector_types,
    current_type,
    max_power_kw,
    price_per_kwh,
    price_tax_included,
    price_tax_rate,
    price_currency,
    price_last_updated,
    source_version,
    first_seen_at,
    last_seen_at,
    closed_at,
    source_publisher,
    source_run_id,
    provider_updated_at,
    created_at,
    updated_at,
    deleted_at,
    deleted_reason,
    deleted_run_id,
    confidentiality,
    extras,
    price_adhoc_zero,
    public.charging_register_opening_hours(extras) AS register_opening_hours,
    public.charging_register_payment_card(extras) AS register_payment_card,
    public.charging_register_free_of_charge(extras) AS register_free_of_charge,
    public.charging_register_parking(extras) AS register_parking
   FROM public.charging_points
  WHERE (deleted_at IS NULL);

CREATE TABLE public.charging_sites (
    source_feed text NOT NULL,
    site_id text NOT NULL,
    source_version text,
    name text,
    operator text,
    operator_id text,
    street text,
    house_number text,
    postcode text,
    city text,
    country_code text,
    geom public.geography(Point,4326) NOT NULL,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    closed_at timestamp with time zone,
    source_publisher text,
    source_run_id bigint,
    provider_updated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    deleted_reason text,
    deleted_run_id bigint,
    road text,
    point_count integer,
    confidentiality text,
    operator_tokens text[] GENERATED ALWAYS AS (public.charging_operator_tokens(operator)) STORED,
    street_key text GENERATED ALWAYS AS (public.charging_street_key(street)) STORED,
    house_key text GENERATED ALWAYS AS (public.charging_house_key(street, house_number)) STORED,
    access_private boolean GENERATED ALWAYS AS ((COALESCE(name, ''::text) ~* '((?<![[:alpha:]])privat(e|er|es)?(?![[:alpha:]])(?![ _-]+((fach)?hochschulen?|universit(ä|ae)t(en)?|uni|kliniken|klinik(um)?|krankenh(a|ä|ae)us(er)?|schulen?|akademie|gymnasium|bank|brauerei|university|school|clinic|hospital|college)(?![[:alpha:]]))|(?<![[:alpha:]])privat(parkpl(a|ä|ae)tz(e|es)?|grundst(ü|ue)ck(e|es|s)?|gel(ä|ae)nde(s)?|einfahrt(en)?)(?![[:alpha:]])|nicht[ _-]?(ö|oe)ffentlich|kein(e|en)?[ _-](ö|oe)ffentlich|(?<![[:alpha:]])not[ _](for[ _])?public(?![[:alpha:]])|(?<![[:alpha:]])non[ _-]public(?![[:alpha:]])|nur[ _]f(ü|ue)r[ _](mitarbeiter|bewohner|anwohner|mieter))'::text)) STORED,
    CONSTRAINT charging_sites_point_count CHECK ((COALESCE(point_count, 0) >= 0)),
    CONSTRAINT charging_sites_postcode_five_digits CHECK ((postcode ~ '^[0-9]{5}$'::text))
)
WITH (autovacuum_vacuum_scale_factor='0.02', fillfactor='60');

CREATE VIEW public.charging_sites_live AS
 SELECT source_feed,
    site_id,
    source_version,
    name,
    operator,
    operator_id,
    street,
    house_number,
    postcode,
    city,
    country_code,
    geom,
    first_seen_at,
    last_seen_at,
    closed_at,
    source_publisher,
    source_run_id,
    provider_updated_at,
    created_at,
    updated_at,
    deleted_at,
    deleted_reason,
    deleted_run_id,
    road,
    point_count,
    confidentiality,
    operator_tokens,
    street_key,
    house_key,
    access_private
   FROM public.charging_sites
  WHERE ((deleted_at IS NULL) AND (NOT access_private));

CREATE TABLE public.charging_status_runs (
    observed_at timestamp with time zone NOT NULL,
    source_feed text NOT NULL,
    source_run_id bigint,
    is_delta boolean NOT NULL,
    stated_at timestamp with time zone NOT NULL,
    ticks integer NOT NULL,
    CONSTRAINT charging_status_runs_ticks_check CHECK ((ticks > 0))
);

CREATE TABLE public.city_traffic_pulls (
    feed_key text NOT NULL,
    observed_at timestamp with time zone NOT NULL,
    measured_at timestamp with time zone,
    segments integer NOT NULL,
    listing text NOT NULL,
    source_run_id bigint,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT city_traffic_pulls_feed_registered CHECK ((feed_key = ANY (ARRAY['hh_verkehrslage'::text, 'bonn_verkehrslage'::text]))),
    CONSTRAINT city_traffic_pulls_listing CHECK ((listing = ANY (ARRAY['all'::text, 'not_free'::text]))),
    CONSTRAINT city_traffic_pulls_segments CHECK ((segments >= 0))
);

CREATE TABLE public.city_traffic_segments (
    id bigint NOT NULL,
    segment_key text NOT NULL,
    ext_id text,
    road_class text,
    geom public.geography(Geometry,4326) NOT NULL,
    first_seen_at timestamp with time zone NOT NULL,
    last_seen_at timestamp with time zone NOT NULL,
    source_feed text NOT NULL,
    source_publisher text NOT NULL,
    source_run_id bigint,
    provider_updated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT city_traffic_segments_feed_registered CHECK ((source_feed = ANY (ARRAY['hh_verkehrslage'::text, 'bonn_verkehrslage'::text]))),
    CONSTRAINT city_traffic_segments_line CHECK ((public.geometrytype((geom)::public.geometry) = ANY (ARRAY['LINESTRING'::text, 'MULTILINESTRING'::text])))
);

CREATE TABLE public.city_traffic_state (
    segment_id bigint NOT NULL,
    status text,
    level text,
    speed_kmh smallint,
    extras jsonb,
    status_since timestamp with time zone NOT NULL,
    last_seen_at timestamp with time zone NOT NULL,
    source_feed text NOT NULL,
    source_publisher text NOT NULL,
    source_run_id bigint,
    provider_updated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT city_traffic_state_feed_registered CHECK ((source_feed = ANY (ARRAY['hh_verkehrslage'::text, 'bonn_verkehrslage'::text]))),
    CONSTRAINT city_traffic_state_level_has_status CHECK (((level IS NULL) OR (status IS NOT NULL))),
    CONSTRAINT city_traffic_state_level_known CHECK (((level IS NULL) OR (level = ANY (ARRAY['freeFlow'::text, 'heavy'::text, 'congested'::text, 'impossible'::text]))))
);

CREATE VIEW public.city_traffic_now_live AS
 SELECT s.id AS segment_id,
    s.source_feed AS feed_key,
    s.road_class,
    s.geom,
    t.status,
    t.level,
    t.speed_kmh,
    p.measured_at,
    t.status_since,
    p.observed_at
   FROM ((public.city_traffic_state t
     JOIN public.city_traffic_segments s ON ((s.id = t.segment_id)))
     JOIN public.city_traffic_pulls p ON (((p.feed_key = t.source_feed) AND (t.last_seen_at = p.observed_at))))
  WHERE (t.status IS NOT NULL);

CREATE VIEW public.city_traffic_pulls_live AS
 SELECT feed_key,
    observed_at,
    measured_at,
    segments,
    listing
   FROM public.city_traffic_pulls;

CREATE SEQUENCE public.city_traffic_segments_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.city_traffic_segments_id_seq OWNED BY public.city_traffic_segments.id;

CREATE VIEW public.city_traffic_segments_live AS
 SELECT id,
    source_feed AS feed_key,
    road_class,
    geom
   FROM public.city_traffic_segments;

CREATE TABLE public.city_traffic_ticks (
    observed_at timestamp with time zone NOT NULL,
    segment_id bigint NOT NULL,
    source_feed text NOT NULL,
    status text,
    level text,
    previous_status text,
    measured_at timestamp with time zone,
    source_run_id bigint
)
PARTITION BY RANGE (observed_at);

CREATE TABLE public.connect_transit_delays (
    observed_at timestamp with time zone NOT NULL,
    feed_ts timestamp with time zone NOT NULL,
    trip_id text NOT NULL,
    stop_id text,
    stop_sequence integer,
    delay_s integer,
    schedule_relationship text DEFAULT 'SCHEDULED'::text NOT NULL,
    source text DEFAULT 'mobilithek_connect_gtfs_rt'::text NOT NULL,
    raw jsonb,
    source_run_id bigint,
    CONSTRAINT connect_transit_delays_licence CHECK ((source = 'mobilithek_connect_gtfs_rt'::text))
)
PARTITION BY RANGE (observed_at);

CREATE VIEW public.connect_transit_delays_live AS
 SELECT DISTINCT ON (trip_id, stop_sequence) trip_id,
    stop_id,
    stop_sequence,
    delay_s,
    schedule_relationship,
        CASE
            WHEN (jsonb_typeof((raw -> 'departure_time'::text)) = 'number'::text) THEN to_timestamp(((raw ->> 'departure_time'::text))::double precision)
            WHEN (jsonb_typeof((raw -> 'arrival_time'::text)) = 'number'::text) THEN to_timestamp(((raw ->> 'arrival_time'::text))::double precision)
            ELSE NULL::timestamp with time zone
        END AS event_at,
        CASE
            WHEN (stop_sequence IS NULL) THEN (raw ->> 'start_date'::text)
            ELSE NULL::text
        END AS start_date,
    observed_at
   FROM public.connect_transit_delays d
  WHERE ((observed_at > (now() - '06:00:00'::interval)) AND (observed_at <= now()))
  ORDER BY trip_id, stop_sequence, observed_at DESC;

CREATE TABLE public.db_facilities (
    equipment_no text NOT NULL,
    station_no text NOT NULL,
    kind text NOT NULL,
    state text NOT NULL,
    state_explanation text,
    description text,
    operator text,
    resume_at timestamp with time zone,
    lon double precision,
    lat double precision,
    extras jsonb DEFAULT '{}'::jsonb NOT NULL,
    state_since timestamp with time zone NOT NULL,
    first_seen_at timestamp with time zone NOT NULL,
    last_seen_at timestamp with time zone NOT NULL,
    source_feed text NOT NULL,
    source_publisher text NOT NULL,
    source_run_id bigint,
    provider_updated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT db_facilities_equipment_digits CHECK ((equipment_no ~ '^[0-9]{1,12}$'::text)),
    CONSTRAINT db_facilities_kind_known CHECK ((kind = ANY (ARRAY['elevator'::text, 'escalator'::text, 'other'::text]))),
    CONSTRAINT db_facilities_source_registered CHECK ((source_feed = 'db_fasta'::text)),
    CONSTRAINT db_facilities_state_known CHECK ((state = ANY (ARRAY['active'::text, 'inactive'::text, 'unknown'::text]))),
    CONSTRAINT db_facilities_station_digits CHECK ((station_no ~ '^[0-9]{1,9}$'::text))
);

CREATE VIEW public.db_facilities_live AS
 SELECT equipment_no,
    station_no,
    kind,
    state,
    state_explanation,
    description,
    resume_at,
    lon,
    lat,
    state_since,
    last_seen_at,
    source_feed
   FROM public.db_facilities;

CREATE TABLE public.db_facility_ticks (
    observed_at timestamp with time zone NOT NULL,
    equipment_no text NOT NULL,
    station_no text NOT NULL,
    kind text NOT NULL,
    state text NOT NULL,
    previous_state text,
    state_explanation text,
    source_run_id bigint,
    CONSTRAINT db_facility_ticks_previous_known CHECK (((previous_state IS NULL) OR (previous_state = ANY (ARRAY['active'::text, 'inactive'::text, 'unknown'::text])))),
    CONSTRAINT db_facility_ticks_state_known CHECK ((state = ANY (ARRAY['active'::text, 'inactive'::text, 'unknown'::text, 'gone'::text])))
)
PARTITION BY RANGE (observed_at);

CREATE TABLE public.db_station_boards (
    station_no text NOT NULL,
    eva_nos text[] NOT NULL,
    read_at timestamp with time zone NOT NULL,
    degraded boolean NOT NULL,
    covers_until timestamp with time zone NOT NULL,
    departures jsonb NOT NULL,
    source_feed text DEFAULT 'db_timetables'::text NOT NULL,
    source_publisher text DEFAULT 'Deutsche Bahn AG'::text NOT NULL,
    source_run_id bigint,
    provider_updated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT db_station_boards_covers CHECK (((covers_until >= read_at) AND (covers_until <= (read_at + '01:30:00'::interval)))),
    CONSTRAINT db_station_boards_departures_bounded CHECK (((jsonb_typeof(departures) = 'array'::text) AND (jsonb_array_length(departures) <= 120))),
    CONSTRAINT db_station_boards_evas CHECK ((((cardinality(eva_nos) >= 1) AND (cardinality(eva_nos) <= 4)) AND (array_position(eva_nos, NULL::text) IS NULL))),
    CONSTRAINT db_station_boards_source_registered CHECK ((source_feed = 'db_timetables'::text)),
    CONSTRAINT db_station_boards_station_digits CHECK ((station_no ~ '^[0-9]{1,9}$'::text))
);

CREATE TABLE public.db_station_numbers (
    eva_no text NOT NULL,
    station_no text NOT NULL,
    name text NOT NULL,
    source_id text DEFAULT 'db_stada'::text NOT NULL,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    part_eva_nos text[] DEFAULT '{}'::text[] NOT NULL,
    category smallint,
    municipality_code text,
    CONSTRAINT db_station_numbers_category_known CHECK (((category >= 1) AND (category <= 7))),
    CONSTRAINT db_station_numbers_eva_digits CHECK ((eva_no ~ '^[0-9]{5,9}$'::text)),
    CONSTRAINT db_station_numbers_municipality_digits CHECK ((municipality_code ~ '^[0-9]{8}$'::text)),
    CONSTRAINT db_station_numbers_part_evas_digits CHECK ((array_to_string(part_eva_nos, ','::text) ~ '^([0-9]{5,9}(,[0-9]{5,9})*)?$'::text)),
    CONSTRAINT db_station_numbers_part_evas_not_main CHECK ((NOT (eva_no = ANY (part_eva_nos)))),
    CONSTRAINT db_station_numbers_source_registered CHECK ((source_id = 'db_stada'::text)),
    CONSTRAINT db_station_numbers_station_digits CHECK ((station_no ~ '^[0-9]{1,9}$'::text))
);

CREATE TABLE public.db_stations (
    station_no text NOT NULL,
    name text NOT NULL,
    eva_no text,
    eva_nos text[] DEFAULT '{}'::text[] NOT NULL,
    ds100 text,
    ifopt text,
    category smallint,
    price_category smallint,
    federal_state text,
    municipality_code text,
    street text,
    zipcode text,
    city text,
    geom public.geography(Point,4326),
    stepless_access text,
    has_parking boolean,
    has_bicycle_parking boolean,
    has_local_public_transport boolean,
    has_public_facilities boolean,
    has_locker_system boolean,
    has_taxi_rank boolean,
    has_travel_necessities boolean,
    has_wifi boolean,
    has_travel_center boolean,
    has_railway_mission boolean,
    has_db_lounge boolean,
    has_lost_and_found boolean,
    has_car_rental boolean,
    mobility_service text,
    mobility_staff jsonb,
    db_information jsonb,
    local_service_staff jsonb,
    service_phone text,
    source_id text DEFAULT 'db_stada'::text NOT NULL,
    content_hash text NOT NULL,
    first_seen_at timestamp with time zone NOT NULL,
    last_seen_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    closed_at timestamp with time zone,
    CONSTRAINT db_stations_category_check CHECK (((category >= 1) AND (category <= 7))),
    CONSTRAINT db_stations_eva_no_check CHECK ((eva_no ~ '^[0-9]{5,9}$'::text)),
    CONSTRAINT db_stations_key_matches_source CHECK ((((source_id = 'db_stada'::text) AND (station_no ~ '^[0-9]{1,9}$'::text)) OR ((source_id = 'delfi_static'::text) AND (station_no ~ '^de:'::text) AND (ifopt = station_no)))),
    CONSTRAINT db_stations_municipality_code_check CHECK ((municipality_code ~ '^[0-9]{8}$'::text)),
    CONSTRAINT db_stations_name_check CHECK (((length(name) >= 1) AND (length(name) <= 200))),
    CONSTRAINT db_stations_price_category_check CHECK (((price_category >= 1) AND (price_category <= 7))),
    CONSTRAINT db_stations_source_id_check CHECK ((source_id = ANY (ARRAY['db_stada'::text, 'delfi_static'::text]))),
    CONSTRAINT db_stations_station_no_check CHECK (((station_no ~ '^[0-9]{1,9}$'::text) OR (station_no ~ '^de:[0-9]{5}:[^:_ ]{1,40}$'::text))),
    CONSTRAINT db_stations_stepless_access_check CHECK ((stepless_access = ANY (ARRAY['yes'::text, 'partial'::text, 'no'::text])))
);

CREATE TABLE public.delfi_service_alerts (
    id bigint NOT NULL,
    source_id text NOT NULL,
    source_feed text NOT NULL,
    alert_id text NOT NULL,
    header text NOT NULL,
    description text,
    cause text,
    effect text,
    url text,
    active_from timestamp with time zone,
    active_to timestamp with time zone,
    active_periods jsonb DEFAULT '[]'::jsonb NOT NULL,
    route_ids text[] DEFAULT '{}'::text[] NOT NULL,
    line_names text[] DEFAULT '{}'::text[] NOT NULL,
    stop_ids text[] DEFAULT '{}'::text[] NOT NULL,
    kreise text[] DEFAULT '{}'::text[] NOT NULL,
    lands text[] DEFAULT '{}'::text[] NOT NULL,
    placed_by text DEFAULT 'none'::text NOT NULL,
    dedupe_key text NOT NULL,
    message_ref text,
    content_hash text NOT NULL,
    confidentiality text,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    closed_at timestamp with time zone,
    source_publisher text,
    source_run_id bigint,
    provider_updated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT delfi_service_alerts_licence CHECK ((source_id = ANY (ARRAY['delfi_rt_sa'::text, 'delfi_siri_sx'::text]))),
    CONSTRAINT delfi_service_alerts_placed_by_check CHECK ((placed_by = ANY (ARRAY['stop'::text, 'route'::text, 'network'::text, 'none'::text])))
);

ALTER TABLE public.delfi_service_alerts ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.delfi_service_alerts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE VIEW public.delfi_service_alerts_live AS
 SELECT source_id,
    source_feed,
    alert_id,
    header,
    active_from,
    active_to,
    active_periods,
    line_names,
    stop_ids,
    kreise,
    placed_by,
    dedupe_key,
    message_ref,
    last_seen_at
   FROM public.delfi_service_alerts a
  WHERE ((closed_at IS NULL) AND (COALESCE(confidentiality, 'noRestriction'::text) = 'noRestriction'::text));

CREATE TABLE public.delfi_siri_et_calls (
    observed_at timestamp with time zone NOT NULL,
    feed_ts timestamp with time zone,
    service_day date NOT NULL,
    journey_ref text NOT NULL,
    stop_ref text NOT NULL,
    visit smallint NOT NULL,
    line text,
    category text,
    operator_ref text,
    destination text,
    aimed_arr timestamp with time zone,
    expected_arr timestamp with time zone,
    aimed_dep timestamp with time zone,
    expected_dep timestamp with time zone,
    delay_s integer,
    platform text,
    recorded boolean DEFAULT false NOT NULL,
    cancelled boolean DEFAULT false NOT NULL,
    journey_cancelled boolean DEFAULT false NOT NULL,
    extra boolean DEFAULT false NOT NULL,
    source_id text DEFAULT 'delfi_siri_et'::text NOT NULL,
    source_run_id bigint,
    source_feed text DEFAULT 'delfi_siri_et'::text NOT NULL,
    vehicle_mode text,
    CONSTRAINT delfi_siri_et_calls_delay CHECK (((delay_s IS NULL) OR (abs(delay_s) <= 21600))),
    CONSTRAINT delfi_siri_et_calls_licence CHECK ((source_id = 'delfi_siri_et'::text)),
    CONSTRAINT delfi_siri_et_calls_visit CHECK ((visit >= 1))
)
PARTITION BY RANGE (observed_at);

CREATE TABLE public.delfi_siri_et_calls_latest (
    stop_ref text NOT NULL,
    service_day date NOT NULL,
    journey_ref text NOT NULL,
    visit smallint NOT NULL,
    source_feed text NOT NULL,
    observed_at timestamp with time zone NOT NULL,
    line text,
    category text,
    destination text,
    platform text,
    aimed_dep timestamp with time zone NOT NULL,
    expected_dep timestamp with time zone,
    delay_s integer,
    recorded boolean NOT NULL,
    cancelled boolean NOT NULL,
    journey_cancelled boolean NOT NULL,
    CONSTRAINT delfi_siri_et_calls_latest_visit CHECK ((visit >= 1))
)
WITH (autovacuum_vacuum_scale_factor='0.02', autovacuum_analyze_scale_factor='0.02', fillfactor='70');

CREATE VIEW public.delfi_siri_et_calls_live AS
 SELECT observed_at,
    service_day,
    journey_ref,
    stop_ref,
    visit,
    line,
    category,
    destination,
    aimed_dep,
    expected_dep,
    delay_s,
    platform,
    recorded,
    cancelled,
    journey_cancelled,
    feed_ts,
    source_feed,
    vehicle_mode
   FROM public.delfi_siri_et_calls c
  WHERE ((observed_at > (now() - '08:00:00'::interval)) AND (observed_at <= now()));

CREATE TABLE public.delfi_siri_et_stop_pairs (
    eva text NOT NULL,
    dhid text NOT NULL,
    station_dhid text NOT NULL,
    matches integer NOT NULL,
    first_seen_at timestamp with time zone NOT NULL,
    confirmed_at timestamp with time zone NOT NULL,
    source_id text DEFAULT 'delfi_siri_et'::text NOT NULL,
    CONSTRAINT delfi_siri_et_stop_pairs_dhid_shape CHECK (((dhid ~ '^de:'::text) AND (station_dhid ~ '^de:'::text))),
    CONSTRAINT delfi_siri_et_stop_pairs_eva_shape CHECK ((eva !~ '^de:'::text)),
    CONSTRAINT delfi_siri_et_stop_pairs_matches CHECK ((matches > 0)),
    CONSTRAINT delfi_siri_et_stop_pairs_source CHECK ((source_id = 'delfi_siri_et'::text))
);

CREATE TABLE public.deployments (
    id bigint NOT NULL,
    deployed_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    version text NOT NULL,
    git_sha text NOT NULL,
    git_ref text,
    previous_git_sha text,
    migration_head integer,
    image_built_at timestamp with time zone,
    deploy_duration_s integer,
    note text,
    app_digest text,
    translator_digest text,
    CONSTRAINT deployments_app_digest_is_a_digest CHECK (((app_digest IS NULL) OR (app_digest ~ '^sha256:[0-9a-f]{64}$'::text))),
    CONSTRAINT deployments_duration_is_sane CHECK (((deploy_duration_s IS NULL) OR ((deploy_duration_s >= 0) AND (deploy_duration_s <= 86400)))),
    CONSTRAINT deployments_git_sha_is_hex CHECK ((git_sha ~ '^[0-9a-f]{7,40}$'::text)),
    CONSTRAINT deployments_migration_head_is_sane CHECK (((migration_head IS NULL) OR (migration_head >= 0))),
    CONSTRAINT deployments_note_is_short CHECK (((note IS NULL) OR (length(note) <= 200))),
    CONSTRAINT deployments_previous_git_sha_is_hex CHECK (((previous_git_sha IS NULL) OR (previous_git_sha ~ '^[0-9a-f]{7,40}$'::text))),
    CONSTRAINT deployments_translator_digest_is_a_digest CHECK (((translator_digest IS NULL) OR (translator_digest ~ '^sha256:[0-9a-f]{64}$'::text))),
    CONSTRAINT deployments_version_is_a_version CHECK ((version ~ '^[0-9]+\.[0-9]+\.[0-9]+([-+][0-9A-Za-z.\-]+)?$'::text))
);

ALTER TABLE public.deployments ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.deployments_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE SEQUENCE public.energy_page_key_generation
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

CREATE TABLE public.energy_page_key_heads (
    kind text NOT NULL,
    generation bigint NOT NULL,
    total integer NOT NULL,
    feed_counts jsonb DEFAULT '{}'::jsonb NOT NULL,
    content_md5 text NOT NULL,
    built_at timestamp with time zone NOT NULL,
    checked_at timestamp with time zone NOT NULL,
    build_ms integer NOT NULL,
    CONSTRAINT energy_page_key_heads_build_ms_check CHECK ((build_ms >= 0)),
    CONSTRAINT energy_page_key_heads_feed_counts_check CHECK ((jsonb_typeof(feed_counts) = 'object'::text)),
    CONSTRAINT energy_page_key_heads_kind_check CHECK ((kind = ANY (ARRAY['fuel'::text, 'charging'::text]))),
    CONSTRAINT energy_page_key_heads_total_check CHECK ((total >= 0))
);

CREATE TABLE public.energy_page_keys (
    kind text NOT NULL,
    generation bigint NOT NULL,
    ord integer NOT NULL,
    source_feed text,
    item_id text NOT NULL,
    brand_operator text,
    name text,
    street text,
    city text,
    day text,
    slug text,
    CONSTRAINT energy_page_keys_check CHECK (((kind = 'fuel'::text) = (source_feed IS NULL))),
    CONSTRAINT energy_page_keys_kind_check CHECK ((kind = ANY (ARRAY['fuel'::text, 'charging'::text]))),
    CONSTRAINT energy_page_keys_ord_check CHECK ((ord >= 1))
)
WITH (autovacuum_vacuum_scale_factor='0.05');

CREATE TABLE public.energy_page_slug_history (
    kind text NOT NULL,
    slug text NOT NULL,
    source_feed text NOT NULL,
    item_id text NOT NULL,
    retired_at timestamp with time zone NOT NULL,
    CONSTRAINT energy_page_slug_history_check CHECK (((kind = 'fuel'::text) = (source_feed = ''::text))),
    CONSTRAINT energy_page_slug_history_kind_check CHECK ((kind = ANY (ARRAY['fuel'::text, 'charging'::text])))
);

CREATE TABLE public.energy_page_slugs (
    kind text NOT NULL,
    source_feed text NOT NULL,
    item_id text NOT NULL,
    slug text NOT NULL,
    assigned_at timestamp with time zone NOT NULL,
    CONSTRAINT energy_page_slugs_check CHECK (((kind = 'fuel'::text) = (source_feed = ''::text))),
    CONSTRAINT energy_page_slugs_kind_check CHECK ((kind = ANY (ARRAY['fuel'::text, 'charging'::text]))),
    CONSTRAINT energy_page_slugs_slug_check CHECK ((((length(slug) >= 1) AND (length(slug) <= 80)) AND (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text) AND (slug !~ '[0-9]{5}'::text)))
);

CREATE TABLE public.error_events (
    hour timestamp with time zone NOT NULL,
    line_sha text NOT NULL,
    service text NOT NULL,
    container text,
    level smallint NOT NULL,
    kind text NOT NULL,
    key text,
    status integer,
    ms integer,
    provider text,
    sqlstate text,
    err_class text,
    message text NOT NULL,
    stack_sha text,
    stack_sample text,
    first_at timestamp with time zone NOT NULL,
    last_at timestamp with time zone NOT NULL,
    count integer NOT NULL,
    CONSTRAINT error_events_check CHECK ((last_at >= first_at)),
    CONSTRAINT error_events_check1 CHECK (((stack_sample IS NULL) = (stack_sha IS NULL))),
    CONSTRAINT error_events_container_check CHECK ((container ~ '^viafrei-[a-z0-9][a-z0-9-]{0,62}$'::text)),
    CONSTRAINT error_events_count_check CHECK ((count >= 1)),
    CONSTRAINT error_events_err_class_check CHECK ((err_class ~ '^[A-Za-z0-9_.-]{1,64}$'::text)),
    CONSTRAINT error_events_hour_check CHECK ((((EXTRACT(epoch FROM hour))::bigint % (3600)::bigint) = 0)),
    CONSTRAINT error_events_key_check CHECK (((key ~ '^[A-Za-z0-9/_.:<>-]{1,64}$'::text) AND (key !~ '\m\d{1,3}(\.\d{1,3}){3}\M'::text) AND (key !~ '[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}'::text) AND (key !~ 'pt:-?[0-9]'::text))),
    CONSTRAINT error_events_kind_check CHECK ((kind ~ '^[a-z][a-z0-9_]{0,47}$'::text)),
    CONSTRAINT error_events_level_check CHECK ((level = ANY (ARRAY[40, 50, 60]))),
    CONSTRAINT error_events_line_sha_check CHECK ((line_sha ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT error_events_message_check CHECK (((char_length(message) <= 300) AND (message !~ '\m\d{1,3}(\.\d{1,3}){3}\M'::text) AND (message !~ '[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}'::text) AND (message !~ 'pt:-?[0-9]'::text))),
    CONSTRAINT error_events_ms_check CHECK ((ms >= 0)),
    CONSTRAINT error_events_provider_check CHECK ((provider ~ '^[a-z][a-z0-9_]{0,63}$'::text)),
    CONSTRAINT error_events_service_check CHECK ((service ~ '^[a-z][a-z0-9-]{0,62}$'::text)),
    CONSTRAINT error_events_sqlstate_check CHECK ((sqlstate ~ '^[0-9A-Z]{5}$'::text)),
    CONSTRAINT error_events_stack_sample_check CHECK (((octet_length(stack_sample) <= 2048) AND (stack_sample !~ '\m\d{1,3}(\.\d{1,3}){3}\M'::text) AND (stack_sample !~ '[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}'::text) AND (stack_sample !~ 'pt:-?[0-9]'::text))),
    CONSTRAINT error_events_stack_sha_check CHECK ((stack_sha ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT error_events_status_check CHECK (((status >= 0) AND (status <= 999)))
);

CREATE VIEW public.feed_checks AS
 SELECT feed_key,
    cadence_s,
    ( SELECT fs.last_success_at
           FROM control.feed_state fs
          WHERE ((fs.ledger = 'feed'::text) AND (fs.key = c.feed_key))) AS checked_at,
    ( SELECT d.paused_since
           FROM control.data_status d
          WHERE ((d.ledger = 'feed'::text) AND (d.key = c.feed_key))) AS paused_at,
    COALESCE(( SELECT d.paused
           FROM control.data_status d
          WHERE ((d.ledger = 'feed'::text) AND (d.key = c.feed_key))), false) AS paused
   FROM public.feed_catalog c
  WHERE (closed_at IS NULL);

CREATE TABLE public.feed_run_extents (
    feed_key text NOT NULL,
    max_items integer,
    max_started_at timestamp with time zone,
    computed_at timestamp with time zone NOT NULL,
    version bigint NOT NULL
);

ALTER TABLE public.feed_runs ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.feed_runs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.feed_versions (
    ledger text NOT NULL,
    key text NOT NULL,
    version bigint NOT NULL,
    observed_at timestamp with time zone NOT NULL,
    CONSTRAINT feed_versions_ledger_check CHECK ((ledger = ANY (ARRAY['feed'::text, 'ingest'::text]))),
    CONSTRAINT feed_versions_version_check CHECK ((version > 0))
);

CREATE TABLE public.feeds (
    id bigint NOT NULL,
    provider text NOT NULL,
    feed_version text NOT NULL,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL,
    active boolean DEFAULT false NOT NULL,
    extras jsonb DEFAULT '{}'::jsonb NOT NULL,
    source_feed text,
    source_publisher text,
    source_run_id bigint,
    provider_updated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    gtfs_feed_key smallint NOT NULL
);

ALTER TABLE public.feeds ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.feeds_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.fuel_city_seed (
    ags text NOT NULL,
    name text NOT NULL,
    radius_km numeric(4,1) NOT NULL,
    last_attempt_at timestamp with time zone NOT NULL,
    last_ok_at timestamp with time zone,
    stations integer,
    source_run_id bigint,
    last_error text,
    CONSTRAINT fuel_city_seed_ags_check CHECK ((ags ~ '^[0-9]{8}$'::text)),
    CONSTRAINT fuel_city_seed_radius_km_check CHECK (((radius_km > (0)::numeric) AND (radius_km <= (25)::numeric))),
    CONSTRAINT fuel_city_seed_stations_check CHECK ((stations >= 0))
);

CREATE TABLE public.fuel_price_latest (
    station_id text NOT NULL,
    product text NOT NULL,
    price numeric(6,3),
    is_open boolean,
    observed_at timestamp with time zone NOT NULL,
    source_feed text,
    source_publisher text,
    source_run_id bigint,
    provider_updated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    deleted_reason text,
    deleted_run_id bigint
);

CREATE VIEW public.fuel_price_latest_live AS
 SELECT station_id,
    product,
    price,
    is_open,
    observed_at,
    source_feed,
    source_publisher,
    source_run_id,
    provider_updated_at,
    created_at,
    updated_at,
    deleted_at,
    deleted_reason,
    deleted_run_id
   FROM public.fuel_price_latest
  WHERE (deleted_at IS NULL);

CREATE TABLE public.fuel_station_watch (
    station_id text NOT NULL,
    tier text DEFAULT 'hourly'::text NOT NULL,
    refresh_interval_s integer DEFAULT 3600 NOT NULL,
    reason text DEFAULT 'seed'::text NOT NULL,
    priority smallint DEFAULT 100 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    added_at timestamp with time zone DEFAULT now() NOT NULL,
    last_polled_at timestamp with time zone,
    last_error text,
    consecutive_errors integer DEFAULT 0 NOT NULL,
    asked_at timestamp with time zone,
    detail_errors smallint DEFAULT 0 NOT NULL,
    detail_attempted_at timestamp with time zone,
    sample_draw_id bigint,
    sample_stratum text,
    sample_role text,
    city_tier smallint,
    city_ags text,
    CONSTRAINT fuel_station_watch_city_ags_check CHECK ((city_ags ~ '^[0-9]{8}$'::text)),
    CONSTRAINT fuel_station_watch_city_pair CHECK (((city_tier IS NULL) = (city_ags IS NULL))),
    CONSTRAINT fuel_station_watch_city_tier_check CHECK ((city_tier = ANY (ARRAY[1, 2]))),
    CONSTRAINT fuel_station_watch_reason_check CHECK ((reason = ANY (ARRAY['seed'::text, 'user'::text, 'region'::text, 'city'::text]))),
    CONSTRAINT fuel_station_watch_refresh_interval_s_check CHECK ((refresh_interval_s >= 300)),
    CONSTRAINT fuel_station_watch_sample_role_check CHECK ((sample_role = ANY (ARRAY['core'::text, 'rotating'::text, 'explorer'::text, 'complete'::text]))),
    CONSTRAINT fuel_station_watch_tier_check CHECK ((tier = ANY (ARRAY['live'::text, 'hourly'::text, 'daily'::text])))
);

CREATE TABLE public.ingest_runs (
    id bigint NOT NULL,
    provider text NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    status text DEFAULT 'running'::text NOT NULL,
    rows integer,
    bytes integer,
    error text,
    skipped_targets integer,
    body_sha256 text,
    duration_ms integer,
    note text,
    next_due_at timestamp with time zone,
    worker_version text,
    budget_hit text
);

CREATE VIEW public.fuel_feed_health AS
 WITH runs AS (
         SELECT ingest_runs.started_at,
            ingest_runs.finished_at,
            ingest_runs.status,
            (ingest_runs.started_at - lag(ingest_runs.started_at) OVER (ORDER BY ingest_runs.started_at)) AS since_previous
           FROM public.ingest_runs
          WHERE ((ingest_runs.provider = 'tankerkoenig'::text) AND (ingest_runs.started_at >= (now() - '24:00:00'::interval)))
        ), watch AS (
         SELECT count(*) FILTER (WHERE fuel_station_watch.active) AS active_stations,
            count(*) FILTER (WHERE (fuel_station_watch.active AND (fuel_station_watch.last_error IS NULL) AND (fuel_station_watch.last_polled_at >= (now() - '01:00:00'::interval)))) AS covered_last_hour,
            count(*) FILTER (WHERE (fuel_station_watch.active AND (fuel_station_watch.last_error IS NOT NULL) AND (fuel_station_watch.last_polled_at >= (now() - '01:00:00'::interval)))) AS station_errors_1h
           FROM public.fuel_station_watch
        )
 SELECT ( SELECT max(l.observed_at) AS max
           FROM (public.fuel_price_latest_live l
             JOIN public.fuel_station_watch w ON (((w.station_id = l.station_id) AND w.active)))) AS newest_observation_at,
    ( SELECT max(ingest_runs.finished_at) AS max
           FROM public.ingest_runs
          WHERE ((ingest_runs.provider = 'tankerkoenig'::text) AND (ingest_runs.status = 'ok'::text))) AS last_ok_run_at,
    ( SELECT max(ingest_runs.started_at) AS max
           FROM public.ingest_runs
          WHERE (ingest_runs.provider = 'tankerkoenig'::text)) AS last_run_at,
    (( SELECT count(*) AS count
           FROM runs))::integer AS runs_24h,
    (( SELECT count(*) AS count
           FROM runs
          WHERE (runs.status = 'degraded'::text)))::integer AS degraded_24h,
    (( SELECT count(*) AS count
           FROM runs
          WHERE (runs.status = 'error'::text)))::integer AS error_24h,
    (( SELECT max(EXTRACT(epoch FROM runs.since_previous)) AS max
           FROM runs))::integer AS longest_gap_s_24h,
    (( SELECT count(*) AS count
           FROM public.ingest_runs
          WHERE ((ingest_runs.provider = 'tankerkoenig'::text) AND (ingest_runs.status = 'error'::text) AND (ingest_runs.started_at >= (now() - '01:00:00'::interval)))))::integer AS error_runs_1h,
    (active_stations)::integer AS active_stations,
    (covered_last_hour)::integer AS covered_last_hour,
    (station_errors_1h)::integer AS station_errors_1h
   FROM watch;

CREATE TABLE public.fuel_prices (
    observed_at timestamp with time zone NOT NULL,
    station_id text NOT NULL,
    product text NOT NULL,
    price numeric(6,3) NOT NULL,
    source text DEFAULT 'tankerkoenig'::text NOT NULL,
    source_run_id bigint
)
PARTITION BY RANGE (observed_at);

CREATE TABLE public.fuel_products (
    code text NOT NULL,
    label text NOT NULL,
    unit text NOT NULL,
    mtsk boolean DEFAULT false NOT NULL,
    active boolean DEFAULT true NOT NULL
);

CREATE TABLE public.fuel_sample_draws (
    id bigint NOT NULL,
    drawn_at timestamp with time zone DEFAULT now() NOT NULL,
    design_version text NOT NULL,
    rng_seed text NOT NULL,
    interval_s integer NOT NULL,
    capacity integer NOT NULL,
    target_total integer NOT NULL,
    drawn_total integer NOT NULL,
    core_share numeric(4,3) NOT NULL,
    land_floor integer NOT NULL,
    history_days integer NOT NULL,
    history_basis integer NOT NULL,
    brand_basis integer NOT NULL,
    notes jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT fuel_sample_draws_basis_sums CHECK (((history_basis + brand_basis) = drawn_total)),
    CONSTRAINT fuel_sample_draws_brand_basis_check CHECK ((brand_basis >= 0)),
    CONSTRAINT fuel_sample_draws_capacity_check CHECK ((capacity >= 0)),
    CONSTRAINT fuel_sample_draws_core_share_check CHECK (((core_share > (0)::numeric) AND (core_share <= (1)::numeric))),
    CONSTRAINT fuel_sample_draws_drawn_total_check CHECK ((drawn_total >= 0)),
    CONSTRAINT fuel_sample_draws_history_basis_check CHECK ((history_basis >= 0)),
    CONSTRAINT fuel_sample_draws_history_days_check CHECK ((history_days > 0)),
    CONSTRAINT fuel_sample_draws_interval_s_check CHECK ((interval_s >= 300)),
    CONSTRAINT fuel_sample_draws_land_floor_check CHECK ((land_floor >= 0)),
    CONSTRAINT fuel_sample_draws_target_total_check CHECK ((target_total >= 0)),
    CONSTRAINT fuel_sample_draws_within_capacity CHECK (((target_total <= capacity) AND (drawn_total <= target_total)))
);

ALTER TABLE public.fuel_sample_draws ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.fuel_sample_draws_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.fuel_sample_strata (
    draw_id bigint NOT NULL,
    stratum text NOT NULL,
    land_ags text NOT NULL,
    settlement_class text NOT NULL,
    brand_class text NOT NULL,
    held integer NOT NULL,
    target integer NOT NULL,
    achieved integer NOT NULL,
    core integer NOT NULL,
    rotating integer NOT NULL,
    CONSTRAINT fuel_sample_strata_achieved_check CHECK ((achieved >= 0)),
    CONSTRAINT fuel_sample_strata_brand_class_check CHECK ((brand_class = ANY (ARRAY['major'::text, 'independent'::text]))),
    CONSTRAINT fuel_sample_strata_core_check CHECK ((core >= 0)),
    CONSTRAINT fuel_sample_strata_held_check CHECK ((held >= 0)),
    CONSTRAINT fuel_sample_strata_key_parts CHECK ((stratum = ((((land_ags || ':'::text) || settlement_class) || ':'::text) || brand_class))),
    CONSTRAINT fuel_sample_strata_land_ags_check CHECK ((land_ags ~ '^[0-9]{2}$'::text)),
    CONSTRAINT fuel_sample_strata_roles_sum CHECK (((core + rotating) = achieved)),
    CONSTRAINT fuel_sample_strata_rotating_check CHECK ((rotating >= 0)),
    CONSTRAINT fuel_sample_strata_settlement_class_check CHECK ((settlement_class = ANY (ARRAY['motorway'::text, 'large_city'::text, 'small_city'::text, 'town'::text, 'rural'::text]))),
    CONSTRAINT fuel_sample_strata_target_check CHECK ((target >= 0)),
    CONSTRAINT fuel_sample_strata_within_held CHECK ((achieved <= held))
);

CREATE TABLE public.fuel_stations (
    id text NOT NULL,
    brand text,
    name text,
    street text,
    house_no text,
    postcode text,
    city text,
    geom public.geography(Point,4326) NOT NULL,
    source text DEFAULT 'tankerkoenig'::text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    opening_times jsonb DEFAULT '[]'::jsonb NOT NULL,
    whole_day boolean,
    state text,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    detail_refreshed_at timestamp with time zone,
    overrides jsonb DEFAULT '[]'::jsonb NOT NULL,
    source_feed text,
    source_publisher text,
    source_run_id bigint,
    provider_updated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    deleted_reason text,
    deleted_run_id bigint,
    land text,
    town_places jsonb,
    CONSTRAINT fuel_stations_postcode_five_digits CHECK ((postcode ~ '^[0-9]{5}$'::text))
);

CREATE VIEW public.fuel_stations_live AS
 SELECT id,
    brand,
    name,
    street,
    house_no,
    postcode,
    city,
    geom,
    source,
    updated_at,
    opening_times,
    whole_day,
    state,
    first_seen_at,
    last_seen_at,
    detail_refreshed_at,
    overrides,
    source_feed,
    source_publisher,
    source_run_id,
    provider_updated_at,
    created_at,
    deleted_at,
    deleted_reason,
    deleted_run_id,
    land,
    town_places
   FROM public.fuel_stations
  WHERE (deleted_at IS NULL);

CREATE VIEW public.fuel_station_board_live AS
 SELECT s.land,
    s.brand,
    s.name,
    s.street,
    s.house_no,
    s.postcode,
    s.city,
    p.e5,
    p.e10,
    p.diesel,
    p.observed_at,
    s.town_places
   FROM (( SELECT f.station_id,
            max(f.observed_at) AS observed_at,
            max(f.price) FILTER (WHERE (f.product = 'e5'::text)) AS e5,
            max(f.price) FILTER (WHERE (f.product = 'e10'::text)) AS e10,
            max(f.price) FILTER (WHERE (f.product = 'diesel'::text)) AS diesel
           FROM public.fuel_price_latest_live f
          WHERE ((f.price IS NOT NULL) AND (f.price > (0)::numeric) AND (f.is_open IS NOT FALSE))
          GROUP BY f.station_id) p
     JOIN public.fuel_stations_live s ON ((s.id = p.station_id)));

CREATE VIEW public.fuel_station_watch_due AS
 SELECT station_id,
    tier,
    priority,
    last_polled_at,
    consecutive_errors
   FROM public.fuel_station_watch
  WHERE (active AND ((last_polled_at IS NULL) OR (last_polled_at <= (now() - make_interval(secs => GREATEST((refresh_interval_s)::double precision, LEAST(((refresh_interval_s)::double precision * power((2)::double precision, (LEAST(GREATEST(((consecutive_errors - 3) + 1), 0), 40))::double precision)), GREATEST((3600)::double precision, ((refresh_interval_s)::double precision * (4)::double precision)))))))))
  ORDER BY priority, last_polled_at NULLS FIRST;

CREATE TABLE public.gazetteer_places (
    id bigint NOT NULL,
    kind text NOT NULL,
    name text NOT NULL,
    name_norm text NOT NULL,
    name_en text,
    admin_code text,
    population integer,
    geom public.geography(Point,4326),
    road text,
    source_id text NOT NULL,
    external_id text NOT NULL,
    rank integer DEFAULT 0 NOT NULL,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    closed_at timestamp with time zone,
    part_of text,
    part_type text,
    CONSTRAINT gazetteer_places_kind_known CHECK ((kind = ANY (ARRAY['city'::text, 'district'::text, 'admin'::text, 'station'::text, 'stop'::text, 'motorway'::text, 'junction'::text, 'island'::text]))),
    CONSTRAINT gazetteer_places_locatable CHECK (((geom IS NOT NULL) OR (road IS NOT NULL))),
    CONSTRAINT gazetteer_places_no_odbl CHECK ((source_id <> 'osm'::text)),
    CONSTRAINT gazetteer_places_part_of_ags CHECK (((part_of IS NULL) OR (part_of ~ '^[0-9]{8}$'::text))),
    CONSTRAINT gazetteer_places_part_pair CHECK (((part_of IS NULL) = (part_type IS NULL))),
    CONSTRAINT gazetteer_places_part_type CHECK (((part_type IS NULL) OR (part_type = ANY (ARRAY['stadtteil'::text, 'ortsteil'::text])))),
    CONSTRAINT gazetteer_places_source_registered CHECK ((source_id = ANY (ARRAY['geonames'::text, 'bkg_gvisys'::text, 'db_stada'::text, 'delfi_zhv'::text, 'autobahn'::text])))
);

ALTER TABLE public.gazetteer_places ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.gazetteer_places_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.gbfs_station_status (
    observed_at timestamp with time zone NOT NULL,
    system_id text NOT NULL,
    station_id text NOT NULL,
    vehicles_available smallint NOT NULL,
    electric_available smallint,
    docks_available smallint,
    is_installed boolean,
    is_renting boolean,
    is_returning boolean,
    reported_at timestamp with time zone,
    source_run_id bigint,
    CONSTRAINT gbfs_station_status_counts CHECK (((vehicles_available >= 0) AND ((electric_available IS NULL) OR ((electric_available >= 0) AND (electric_available <= vehicles_available))) AND ((docks_available IS NULL) OR (docks_available >= 0))))
)
PARTITION BY RANGE (observed_at);

CREATE VIEW public.gbfs_station_status_live AS
 SELECT system_id,
    station_id,
    vehicles_available,
    electric_available,
    docks_available,
    is_renting,
    is_returning,
    observed_at,
    reported_at
   FROM public.gbfs_station_status t
  WHERE (observed_at > (now() - '25:00:00'::interval));

CREATE TABLE public.gbfs_stations (
    system_id text NOT NULL,
    station_id text NOT NULL,
    name text,
    capacity integer,
    is_virtual boolean,
    geom public.geography(Point,4326) NOT NULL,
    first_seen_at timestamp with time zone NOT NULL,
    last_seen_at timestamp with time zone NOT NULL,
    closed_at timestamp with time zone,
    source_feed text NOT NULL,
    source_publisher text NOT NULL,
    source_run_id bigint,
    provider_updated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT gbfs_stations_source_known CHECK ((source_feed = ANY (ARRAY['gbfs_nextbike'::text, 'gbfs_donkey'::text])))
);

CREATE TABLE public.gbfs_systems (
    system_id text NOT NULL,
    publisher text NOT NULL,
    name text,
    operator text,
    gbfs_version text,
    license_id text,
    admitted boolean NOT NULL,
    refused_reason text,
    licence_read_at timestamp with time zone NOT NULL,
    ttl_s integer,
    status_seen_at timestamp with time zone,
    vehicles_seen_at timestamp with time zone,
    first_seen_at timestamp with time zone NOT NULL,
    last_seen_at timestamp with time zone NOT NULL,
    source_feed text NOT NULL,
    source_publisher text NOT NULL,
    source_run_id bigint,
    provider_updated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    licence_basis text,
    CONSTRAINT gbfs_systems_admitted_licence CHECK (((NOT admitted) OR COALESCE((license_id = 'CC0-1.0'::text), false) OR ((license_id IS NULL) AND (licence_basis = 'gbfs_3_default'::text) AND COALESCE((gbfs_version ~ '^3\.[0-9]{1,2}$'::text), false)))),
    CONSTRAINT gbfs_systems_basis_iff_admitted CHECK ((admitted = (licence_basis IS NOT NULL))),
    CONSTRAINT gbfs_systems_licence_basis_known CHECK ((licence_basis = ANY (ARRAY['stated'::text, 'gbfs_3_default'::text]))),
    CONSTRAINT gbfs_systems_publisher_known CHECK ((publisher = ANY (ARRAY['gbfs_nextbike'::text, 'gbfs_donkey'::text]))),
    CONSTRAINT gbfs_systems_refusal_reasoned CHECK ((admitted OR (refused_reason IS NOT NULL))),
    CONSTRAINT gbfs_systems_source_is_publisher CHECK ((source_feed = publisher))
);

CREATE VIEW public.gbfs_stations_live AS
 SELECT st.system_id,
    st.station_id,
    st.name,
    st.capacity,
    st.is_virtual,
    st.geom,
    st.last_seen_at,
    st.source_feed,
    sy.status_seen_at,
    sy.name AS system_name
   FROM (public.gbfs_stations st
     JOIN public.gbfs_systems sy USING (system_id))
  WHERE ((st.closed_at IS NULL) AND sy.admitted);

CREATE TABLE public.gbfs_vehicles (
    system_id text NOT NULL,
    seq integer NOT NULL,
    form_factor text,
    propulsion text,
    range_m integer,
    geom public.geography(Point,4326) NOT NULL,
    observed_at timestamp with time zone NOT NULL,
    source_feed text NOT NULL,
    source_publisher text NOT NULL,
    source_run_id bigint,
    provider_updated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT gbfs_vehicles_source_known CHECK ((source_feed = ANY (ARRAY['gbfs_nextbike'::text, 'gbfs_donkey'::text])))
);

CREATE VIEW public.gbfs_vehicles_live AS
 SELECT v.system_id,
    v.form_factor,
    v.propulsion,
    v.range_m,
    v.geom,
    v.observed_at,
    v.source_feed,
    sy.vehicles_seen_at,
    sy.name AS system_name
   FROM (public.gbfs_vehicles v
     JOIN public.gbfs_systems sy USING (system_id))
  WHERE sy.admitted;

CREATE TABLE public.growth_weekly (
    week date NOT NULL,
    computed_at timestamp with time zone DEFAULT now() NOT NULL,
    complete boolean NOT NULL,
    search_state text NOT NULL,
    search_impressions bigint,
    search_clicks bigint,
    search_position numeric(6,2),
    site_state text NOT NULL,
    site_days smallint NOT NULL,
    people_views integer,
    own_views integer,
    crawler_views integer,
    automation_views integer,
    home_views integer,
    connect_views integer,
    mcp_state text NOT NULL,
    mcp_initialize_ext integer,
    mcp_calls_ext integer,
    mcp_errors_ext integer,
    mcp_clients_ext integer,
    mcp_calls_own integer,
    directory_listings integer,
    CONSTRAINT growth_weekly_check CHECK (((search_state = 'read'::text) = (search_impressions IS NOT NULL))),
    CONSTRAINT growth_weekly_check1 CHECK (((site_state = 'unread'::text) = (people_views IS NULL))),
    CONSTRAINT growth_weekly_check2 CHECK (((mcp_state = 'read'::text) = (mcp_calls_ext IS NOT NULL))),
    CONSTRAINT growth_weekly_mcp_state_check CHECK ((mcp_state = ANY (ARRAY['read'::text, 'unread'::text]))),
    CONSTRAINT growth_weekly_search_state_check CHECK ((search_state = ANY (ARRAY['read'::text, 'unread'::text]))),
    CONSTRAINT growth_weekly_site_days_check CHECK (((site_days >= 0) AND (site_days <= 7))),
    CONSTRAINT growth_weekly_site_state_check CHECK ((site_state = ANY (ARRAY['read'::text, 'partial'::text, 'unread'::text]))),
    CONSTRAINT growth_weekly_week_check CHECK ((EXTRACT(isodow FROM week) = (1)::numeric))
);

CREATE TABLE public.stop_times (
    arrival interval,
    departure interval,
    deleted_at timestamp with time zone,
    deleted_run_id bigint,
    stop_sequence integer NOT NULL,
    gtfs_feed_key smallint NOT NULL,
    pickup_type smallint DEFAULT 0 NOT NULL,
    drop_off_type smallint DEFAULT 0 NOT NULL,
    trip_id text NOT NULL,
    stop_id text NOT NULL,
    deleted_reason text
);
ALTER TABLE ONLY public.stop_times ALTER COLUMN trip_id SET (n_distinct=-0.05);

CREATE TABLE public.trips (
    deleted_at timestamp with time zone,
    deleted_run_id bigint,
    loaded_run_id bigint,
    gtfs_feed_key smallint NOT NULL,
    direction_id smallint,
    id text NOT NULL,
    route_id text NOT NULL,
    service_id text NOT NULL,
    headsign text,
    shape_id text,
    deleted_reason text,
    stop_times_fp integer,
    trip_short_name text
);

CREATE MATERIALIZED VIEW public.gtfs_route_kreise AS
 SELECT t.gtfs_feed_key,
    t.route_id,
    array_agg(DISTINCT k.kreis ORDER BY k.kreis) AS kreise
   FROM (( SELECT st.gtfs_feed_key,
            st.trip_id,
            SUBSTRING(st.stop_id FROM 4 FOR 5) AS kreis
           FROM public.stop_times st
          WHERE ((st.deleted_at IS NULL) AND (st.stop_id ~~ 'de:_____:%'::text))
          GROUP BY st.gtfs_feed_key, st.trip_id, (SUBSTRING(st.stop_id FROM 4 FOR 5))) k
     JOIN public.trips t ON (((t.gtfs_feed_key = k.gtfs_feed_key) AND (t.id = k.trip_id))))
  WHERE ((t.deleted_at IS NULL) AND (k.kreis ~ '^\d{5}$'::text))
  GROUP BY t.gtfs_feed_key, t.route_id
  WITH NO DATA;

CREATE TABLE public.gtfs_service_dates (
    service_date date NOT NULL,
    gtfs_feed_key smallint NOT NULL,
    service_id text NOT NULL
);

CREATE TABLE public.gtfs_stale_trips (
    gtfs_feed_key smallint NOT NULL,
    trip_id text NOT NULL,
    retired_run_id bigint NOT NULL,
    retired_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE MATERIALIZED VIEW public.gtfs_untimed_trips AS
 SELECT gtfs_feed_key,
    trip_id
   FROM public.stop_times st
  WHERE (deleted_at IS NULL)
  GROUP BY gtfs_feed_key, trip_id
 HAVING ((count(*) > 1) AND (min(COALESCE(departure, arrival)) = max(COALESCE(arrival, departure))))
  WITH NO DATA;

CREATE TABLE public.hh_cameras (
    camera_id text NOT NULL,
    location_label text NOT NULL,
    note text,
    geom public.geometry(Point,4326) NOT NULL,
    first_seen_at timestamp with time zone NOT NULL,
    last_seen_at timestamp with time zone NOT NULL,
    closed_at timestamp with time zone,
    source_feed text NOT NULL,
    source_publisher text NOT NULL,
    source_run_id bigint,
    provider_updated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT hh_cameras_source_known CHECK ((source_feed = 'hh_verkehrskameras'::text))
);

CREATE VIEW public.hh_cameras_live AS
 SELECT camera_id,
    location_label,
    geom,
    last_seen_at,
    closed_at
   FROM public.hh_cameras c
  WHERE (closed_at IS NULL);

CREATE TABLE public.hh_roadwork_versions (
    site_id text NOT NULL,
    content_hash text NOT NULL,
    observed_at timestamp with time zone NOT NULL,
    provider_updated_at timestamp with time zone,
    released boolean NOT NULL,
    starts_on date,
    ends_on date,
    props jsonb NOT NULL,
    geom public.geometry(Point,4326) NOT NULL,
    source_run_id bigint
);

CREATE TABLE public.hh_roadworks (
    site_id text NOT NULL,
    title text NOT NULL,
    organisation text,
    cause text,
    scope text,
    starts_on date,
    ends_on date,
    released boolean NOT NULL,
    hotspot boolean DEFAULT false NOT NULL,
    link text,
    props jsonb NOT NULL,
    geom public.geometry(Point,4326) NOT NULL,
    content_hash text NOT NULL,
    first_seen_at timestamp with time zone NOT NULL,
    last_seen_at timestamp with time zone NOT NULL,
    closed_at timestamp with time zone,
    source_feed text NOT NULL,
    source_publisher text NOT NULL,
    source_run_id bigint,
    provider_updated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT hh_roadworks_dates_ordered CHECK (((starts_on IS NULL) OR (ends_on IS NULL) OR (starts_on <= ends_on))),
    CONSTRAINT hh_roadworks_source_known CHECK ((source_feed = 'hh_bauweiser'::text))
);

CREATE VIEW public.hh_roadworks_live AS
 SELECT site_id,
    title,
    organisation,
    cause,
    scope,
    starts_on,
    ends_on,
    hotspot,
    link,
    geom,
    first_seen_at,
    last_seen_at,
    provider_updated_at,
    source_feed,
    source_publisher
   FROM public.hh_roadworks
  WHERE ((closed_at IS NULL) AND released);

CREATE TABLE public.host_samples (
    sampled_at timestamp with time zone NOT NULL,
    disk_total_b bigint NOT NULL,
    disk_used_b bigint NOT NULL,
    disk_avail_b bigint NOT NULL,
    mem_total_b bigint NOT NULL,
    mem_available_b bigint NOT NULL,
    db_size_b bigint NOT NULL,
    containers jsonb DEFAULT '[]'::jsonb NOT NULL,
    CONSTRAINT host_samples_containers_check CHECK ((jsonb_typeof(containers) = 'array'::text)),
    CONSTRAINT host_samples_db_size_b_check CHECK ((db_size_b >= 0)),
    CONSTRAINT host_samples_disk_avail_b_check CHECK ((disk_avail_b >= 0)),
    CONSTRAINT host_samples_disk_total_b_check CHECK ((disk_total_b > 0)),
    CONSTRAINT host_samples_disk_used_b_check CHECK ((disk_used_b >= 0)),
    CONSTRAINT host_samples_mem_available_b_check CHECK ((mem_available_b >= 0)),
    CONSTRAINT host_samples_mem_total_b_check CHECK ((mem_total_b > 0))
);

CREATE TABLE public.hydrogen_stations (
    id bigint NOT NULL,
    source_feed text NOT NULL,
    external_id text NOT NULL,
    name text,
    operator text,
    brand text,
    geom public.geography(Point,4326) NOT NULL,
    address jsonb,
    refill jsonb NOT NULL,
    opening jsonb,
    attribution_id text NOT NULL,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    closed_at timestamp with time zone,
    source_publisher text,
    source_run_id bigint,
    provider_updated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT hydrogen_stations_licence CHECK ((attribution_id = 'mobilithek_h2_stations'::text)),
    CONSTRAINT hydrogen_stations_refill_nonempty CHECK (((jsonb_typeof(refill) = 'array'::text) AND (jsonb_array_length(refill) > 0)))
);

CREATE SEQUENCE public.hydrogen_stations_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.hydrogen_stations_id_seq OWNED BY public.hydrogen_stations.id;

CREATE VIEW public.hydrogen_stations_live AS
 SELECT id,
    source_feed,
    external_id,
    name,
    operator,
    brand,
    geom,
    address,
    refill,
    opening,
    attribution_id,
    provider_updated_at,
    first_seen_at,
    last_seen_at,
    closed_at
   FROM public.hydrogen_stations
  WHERE (closed_at IS NULL);

ALTER TABLE public.ingest_runs ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.ingest_runs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.landing_collect_cursor (
    stream text NOT NULL,
    signature text NOT NULL,
    byte_offset bigint NOT NULL,
    collected_at timestamp with time zone NOT NULL,
    CONSTRAINT landing_collect_cursor_byte_offset_check CHECK ((byte_offset >= 0)),
    CONSTRAINT landing_collect_cursor_signature_check CHECK ((signature ~ '^[0-9T:/ +-]{0,32}$'::text)),
    CONSTRAINT landing_collect_cursor_stream_check CHECK ((stream = ANY (ARRAY['access'::text, 'error'::text])))
);

CREATE TABLE public.landing_error_hourly (
    hour timestamp with time zone NOT NULL,
    kind text NOT NULL,
    zone text DEFAULT ''::text NOT NULL,
    n bigint NOT NULL,
    CONSTRAINT landing_error_hourly_check CHECK (((zone ~ '^[a-z0-9_]{0,32}$'::text) AND ((kind = 'limit'::text) OR (zone = ''::text)))),
    CONSTRAINT landing_error_hourly_hour_check CHECK (((EXTRACT(minute FROM (hour AT TIME ZONE 'UTC'::text)) = (0)::numeric) AND (EXTRACT(second FROM (hour AT TIME ZONE 'UTC'::text)) = (0)::numeric))),
    CONSTRAINT landing_error_hourly_kind_check CHECK ((kind = ANY (ARRAY['limit'::text, 'upstream_timeout'::text, 'upstream_connect'::text, 'upstream_resolve'::text, 'upstream_header'::text, 'upstream_asset'::text, 'upstream_other'::text, 'error'::text, 'warn'::text]))),
    CONSTRAINT landing_error_hourly_n_check CHECK ((n >= 0))
);

CREATE TABLE public.landing_reloads (
    at timestamp with time zone DEFAULT now() NOT NULL,
    service text NOT NULL,
    action text NOT NULL,
    result text NOT NULL,
    CONSTRAINT landing_reloads_action_check CHECK ((action = ANY (ARRAY['kept'::text, 'recreate'::text, 'served-check'::text]))),
    CONSTRAINT landing_reloads_result_check CHECK ((result = ANY (ARRAY['ok'::text, 'failed'::text, 'drift'::text, 'unknown'::text]))),
    CONSTRAINT landing_reloads_service_check CHECK ((service = ANY (ARRAY['landing'::text, 'fragcache'::text])))
);

CREATE TABLE public.landing_status_hourly (
    hour timestamp with time zone NOT NULL,
    route_class text NOT NULL,
    agent_class text NOT NULL,
    status smallint NOT NULL,
    n bigint NOT NULL,
    CONSTRAINT landing_status_hourly_agent_class_check CHECK ((agent_class = ANY (ARRAY['person'::text, 'search'::text, 'crawler'::text, 'automation'::text]))),
    CONSTRAINT landing_status_hourly_hour_check CHECK (((EXTRACT(minute FROM (hour AT TIME ZONE 'UTC'::text)) = (0)::numeric) AND (EXTRACT(second FROM (hour AT TIME ZONE 'UTC'::text)) = (0)::numeric))),
    CONSTRAINT landing_status_hourly_n_check CHECK ((n >= 0)),
    CONSTRAINT landing_status_hourly_route_class_check CHECK ((route_class = ANY (ARRAY['home'::text, 'page'::text, 'place'::text, 'station'::text, 'motorway'::text, 'fragment'::text, 'asset'::text, 'meta'::text, 'other'::text]))),
    CONSTRAINT landing_status_hourly_status_check CHECK (((status >= 100) AND (status <= 599)))
);

CREATE TABLE public.lez_zone_overlaps (
    source_feed text NOT NULL,
    zone_id text NOT NULL,
    other_feed text NOT NULL,
    other_zone_id text NOT NULL,
    shared_area double precision NOT NULL,
    smaller_area double precision NOT NULL,
    computed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT lez_zone_overlaps_two_feeds CHECK ((source_feed <> other_feed))
);

CREATE TABLE public.lez_zone_versions (
    source_feed text NOT NULL,
    zone_id text NOT NULL,
    content_hash text NOT NULL,
    observed_at timestamp with time zone NOT NULL,
    role text NOT NULL,
    name text NOT NULL,
    props jsonb NOT NULL,
    geom public.geometry(Geometry,4326) NOT NULL,
    source_run_id bigint
);

CREATE TABLE public.lez_zones (
    source_feed text NOT NULL,
    source_publisher text NOT NULL,
    zone_id text NOT NULL,
    role text NOT NULL,
    name text NOT NULL,
    props jsonb NOT NULL,
    geom public.geometry(Geometry,4326) NOT NULL,
    content_hash text NOT NULL,
    first_seen_at timestamp with time zone NOT NULL,
    last_seen_at timestamp with time zone NOT NULL,
    closed_at timestamp with time zone,
    source_run_id bigint,
    provider_updated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    geom_m public.geometry(Geometry,25832) GENERATED ALWAYS AS (public.st_transform(geom, 25832)) STORED,
    place_name text,
    CONSTRAINT lez_zones_area_is_area CHECK (((role = 'exempt_road'::text) OR (public.geometrytype(geom) = ANY (ARRAY['POLYGON'::text, 'MULTIPOLYGON'::text])))),
    CONSTRAINT lez_zones_role_known CHECK ((role = ANY (ARRAY['zone'::text, 'exempt_road'::text, 'transfer'::text])))
);

CREATE VIEW public.lez_zones_live AS
 SELECT source_feed,
    source_publisher,
    zone_id,
    role,
    name,
    geom,
    last_seen_at,
    provider_updated_at,
    geom_m,
    place_name
   FROM public.lez_zones
  WHERE (closed_at IS NULL);

CREATE TABLE public.lorry_city (
    id bigint NOT NULL,
    source_feed text NOT NULL,
    feature_key text NOT NULL,
    layer text NOT NULL,
    publisher_id text,
    group_id text,
    road text,
    road_raw text,
    land text,
    street text,
    municipality text,
    district text,
    kind text,
    sign text,
    value numeric(8,2),
    unit text,
    published_text text,
    exceptions text[] DEFAULT '{}'::text[] NOT NULL,
    times text,
    days text,
    one_way boolean,
    category text,
    direction text,
    length_m numeric(10,1),
    network_state text,
    ordinance text,
    version_date date,
    geom public.geography(Geometry,4326) NOT NULL,
    raw jsonb DEFAULT '{}'::jsonb NOT NULL,
    first_seen_at timestamp with time zone NOT NULL,
    closed_at timestamp with time zone,
    source_publisher text NOT NULL,
    source_run_id bigint,
    provider_updated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT lorry_city_category CHECK ((category = ANY (ARRAY['connection_motorway'::text, 'connection_primary'::text, 'connection_secondary'::text, 'connection_delivery'::text, 'lorry_priority_route'::text, 'heavy_transport'::text]))),
    CONSTRAINT lorry_city_class_on_network CHECK (((layer = 'priority_route'::text) = (category IS NOT NULL))),
    CONSTRAINT lorry_city_kind CHECK (((layer = 'priority_route'::text) OR (kind IS NOT NULL))),
    CONSTRAINT lorry_city_layer CHECK ((layer = ANY (ARRAY['priority_route'::text, 'restriction'::text, 'zone'::text]))),
    CONSTRAINT lorry_city_source CHECK ((source_feed = ANY (ARRAY['lorry_koeln_verbindungen'::text, 'lorry_koeln_beschraenkungen'::text, 'lorry_dresden_verbotszonen'::text, 'lorry_dresden_vorrangrouten'::text, 'lorry_hh_gst_netz'::text]))),
    CONSTRAINT lorry_city_value_unit CHECK (((value IS NULL) = (unit IS NULL))),
    CONSTRAINT lorry_city_zone_dated CHECK (((layer <> 'zone'::text) OR (version_date IS NOT NULL)))
);

ALTER TABLE public.lorry_city ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.lorry_city_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE VIEW public.lorry_city_live AS
 SELECT id,
    source_feed,
    layer,
    publisher_id,
    road,
    road_raw,
    street,
    kind,
    sign,
    value,
    unit,
    exceptions,
    times,
    days,
    category,
    length_m,
    version_date,
    geom,
    first_seen_at,
    published_text,
    district,
    direction,
    group_id
   FROM public.lorry_city
  WHERE (closed_at IS NULL);

CREATE TABLE public.lorry_hb (
    id bigint NOT NULL,
    source_feed text NOT NULL,
    feature_key text NOT NULL,
    layer text NOT NULL,
    publisher_id text,
    group_id text,
    road text,
    road_raw text,
    land text,
    street text,
    municipality text,
    district text,
    kind text,
    sign text,
    value numeric(8,2),
    unit text,
    published_text text,
    exceptions text[] DEFAULT '{}'::text[] NOT NULL,
    times text,
    days text,
    one_way boolean,
    category text,
    direction text,
    length_m numeric(10,1),
    network_state text,
    ordinance text,
    version_date date,
    geom public.geography(Geometry,4326) NOT NULL,
    raw jsonb DEFAULT '{}'::jsonb NOT NULL,
    first_seen_at timestamp with time zone NOT NULL,
    closed_at timestamp with time zone,
    source_publisher text NOT NULL,
    source_run_id bigint,
    provider_updated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT lorry_hb_layer CHECK ((layer = 'restriction'::text)),
    CONSTRAINT lorry_hb_source CHECK ((source_feed = ANY (ARRAY['lorry_hb_durchfahrtshoehen'::text, 'lorry_hb_fuehrungshoehen'::text]))),
    CONSTRAINT lorry_hb_value_unparsed CHECK (((value IS NULL) AND (unit IS NULL) AND (published_text IS NOT NULL) AND (publisher_id IS NOT NULL)))
);

ALTER TABLE public.lorry_hb ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.lorry_hb_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE VIEW public.lorry_hb_live AS
 SELECT id,
    source_feed,
    layer,
    publisher_id,
    kind,
    sign,
    published_text,
    value,
    unit,
    exceptions,
    times,
    days,
    version_date,
    geom,
    first_seen_at
   FROM public.lorry_hb
  WHERE (closed_at IS NULL);

CREATE TABLE public.lorry_ivm (
    id bigint NOT NULL,
    source_feed text NOT NULL,
    feature_key text NOT NULL,
    layer text NOT NULL,
    publisher_id text,
    group_id text,
    road text,
    road_raw text,
    land text,
    street text,
    municipality text,
    district text,
    kind text,
    sign text,
    value numeric(8,2),
    unit text,
    published_text text,
    exceptions text[] DEFAULT '{}'::text[] NOT NULL,
    times text,
    days text,
    one_way boolean,
    category text,
    direction text,
    length_m numeric(10,1),
    network_state text,
    ordinance text,
    version_date date,
    geom public.geography(Geometry,4326) NOT NULL,
    raw jsonb DEFAULT '{}'::jsonb NOT NULL,
    first_seen_at timestamp with time zone NOT NULL,
    closed_at timestamp with time zone,
    source_publisher text NOT NULL,
    source_run_id bigint,
    provider_updated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT lorry_ivm_layer CHECK ((((source_feed = 'lorry_ivm_vorrangnetz'::text) AND (layer = 'priority_route'::text)) OR ((source_feed = 'lorry_ivm_beschilderung'::text) AND (layer = 'restriction'::text)))),
    CONSTRAINT lorry_ivm_source CHECK ((source_feed = ANY (ARRAY['lorry_ivm_vorrangnetz'::text, 'lorry_ivm_beschilderung'::text])))
);

ALTER TABLE public.lorry_ivm ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.lorry_ivm_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE VIEW public.lorry_ivm_live AS
 SELECT id,
    source_feed,
    layer,
    publisher_id,
    kind,
    sign,
    value,
    unit,
    exceptions,
    times,
    days,
    one_way,
    category,
    version_date,
    geom,
    first_seen_at
   FROM public.lorry_ivm
  WHERE (closed_at IS NULL);

CREATE TABLE public.lorry_long_network (
    id bigint NOT NULL,
    source_feed text NOT NULL,
    feature_key text NOT NULL,
    layer text NOT NULL,
    publisher_id text,
    group_id text,
    road text,
    road_raw text,
    land text,
    street text,
    municipality text,
    district text,
    kind text,
    sign text,
    value numeric(8,2),
    unit text,
    published_text text,
    exceptions text[] DEFAULT '{}'::text[] NOT NULL,
    times text,
    days text,
    one_way boolean,
    category text,
    direction text,
    length_m numeric(10,1),
    network_state text,
    ordinance text,
    version_date date,
    geom public.geography(Geometry,4326) NOT NULL,
    raw jsonb DEFAULT '{}'::jsonb NOT NULL,
    first_seen_at timestamp with time zone NOT NULL,
    closed_at timestamp with time zone,
    source_publisher text NOT NULL,
    source_run_id bigint,
    provider_updated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT lorry_long_network_layer CHECK ((layer = 'long_lorry'::text)),
    CONSTRAINT lorry_long_network_source CHECK ((source_feed = ANY (ARRAY['lorry_bast_langlkw'::text, 'lorry_hh_langlkw'::text])))
);

ALTER TABLE public.lorry_long_network ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.lorry_long_network_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE VIEW public.lorry_long_network_live AS
 SELECT id,
    source_feed,
    layer,
    road,
    road_raw,
    land,
    direction,
    one_way,
    length_m,
    network_state,
    ordinance,
    version_date,
    geom,
    first_seen_at
   FROM public.lorry_long_network
  WHERE (closed_at IS NULL);

CREATE VIEW public.lorry_reads_live AS
 SELECT feed_key AS source_feed,
    max(finished_at) AS read_at
   FROM public.feed_runs f
  WHERE ((feed_key = ANY (ARRAY['lorry_bast_langlkw'::text, 'lorry_hh_langlkw'::text, 'lorry_sevas_nrw'::text, 'lorry_ivm_vorrangnetz'::text, 'lorry_ivm_beschilderung'::text, 'lorry_hb_durchfahrtshoehen'::text, 'lorry_hb_fuehrungshoehen'::text, 'lorry_koeln_verbindungen'::text, 'lorry_koeln_beschraenkungen'::text, 'lorry_dresden_verbotszonen'::text, 'lorry_dresden_vorrangrouten'::text, 'lorry_hh_gst_netz'::text])) AND ((status = ANY (ARRAY['ok'::text, 'unchanged'::text])) OR ((status = 'degraded'::text) AND (items_changed IS NOT NULL))) AND (finished_at IS NOT NULL))
  GROUP BY feed_key;

CREATE TABLE public.lorry_sevas (
    id bigint NOT NULL,
    source_feed text NOT NULL,
    feature_key text NOT NULL,
    layer text NOT NULL,
    publisher_id text,
    group_id text,
    road text,
    road_raw text,
    land text,
    street text,
    municipality text,
    district text,
    kind text,
    sign text,
    value numeric(8,2),
    unit text,
    published_text text,
    exceptions text[] DEFAULT '{}'::text[] NOT NULL,
    times text,
    days text,
    one_way boolean,
    category text,
    direction text,
    length_m numeric(10,1),
    network_state text,
    ordinance text,
    version_date date,
    geom public.geography(Geometry,4326) NOT NULL,
    raw jsonb DEFAULT '{}'::jsonb NOT NULL,
    first_seen_at timestamp with time zone NOT NULL,
    closed_at timestamp with time zone,
    source_publisher text NOT NULL,
    source_run_id bigint,
    provider_updated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT lorry_sevas_layer CHECK ((layer = ANY (ARRAY['restriction'::text, 'priority_route'::text]))),
    CONSTRAINT lorry_sevas_source CHECK ((source_feed = 'lorry_sevas_nrw'::text))
);

ALTER TABLE public.lorry_sevas ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.lorry_sevas_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE VIEW public.lorry_sevas_live AS
 SELECT id,
    source_feed,
    layer,
    publisher_id,
    group_id,
    street,
    municipality,
    district,
    kind,
    sign,
    value,
    unit,
    exceptions,
    times,
    days,
    one_way,
    network_state,
    version_date,
    geom,
    first_seen_at
   FROM public.lorry_sevas
  WHERE (closed_at IS NULL);

CREATE TABLE public.los_lane_sites (
    lane_id text NOT NULL,
    site_id text NOT NULL,
    lane integer NOT NULL,
    geom public.geography(Point,4326),
    version text,
    confidentiality text,
    first_seen_at timestamp with time zone NOT NULL,
    last_seen_at timestamp with time zone NOT NULL,
    closed_at timestamp with time zone,
    source_feed text NOT NULL,
    source_publisher text NOT NULL,
    source_run_id bigint,
    provider_updated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT los_lane_sites_lane_range CHECK (((lane >= 1) AND (lane <= 99))),
    CONSTRAINT los_lane_sites_site_shape CHECK ((site_id ~ '^mq\.'::text)),
    CONSTRAINT los_lane_sites_source_registered CHECK ((source_feed = 'los_nrw_lane_sites'::text))
);

CREATE TABLE public.los_lane_state (
    lane_id text NOT NULL,
    site_id text NOT NULL,
    status text NOT NULL,
    measured_at timestamp with time zone,
    status_since timestamp with time zone NOT NULL,
    last_seen_at timestamp with time zone NOT NULL,
    confidentiality text,
    source_feed text NOT NULL,
    source_publisher text NOT NULL,
    source_run_id bigint,
    provider_updated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT los_lane_state_source_registered CHECK ((source_feed = 'los_nrw_lanes'::text))
);

CREATE TABLE public.los_sites (
    site_id text NOT NULL,
    section text,
    carriageway text NOT NULL,
    direction text,
    geom public.geography(Point,4326),
    road text,
    road_rule text,
    version text,
    confidentiality text,
    first_seen_at timestamp with time zone NOT NULL,
    last_seen_at timestamp with time zone NOT NULL,
    closed_at timestamp with time zone,
    source_feed text NOT NULL,
    source_publisher text NOT NULL,
    source_run_id bigint,
    provider_updated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT los_sites_carriageway_known CHECK ((carriageway = ANY (ARRAY['hfb'::text, 'entry'::text, 'exit'::text, 'other'::text]))),
    CONSTRAINT los_sites_road_shape CHECK (((road IS NULL) OR (road ~ '^A[1-9][0-9]{0,2}$'::text))),
    CONSTRAINT los_sites_rule_known CHECK (((road_rule IS NULL) OR (road_rule = ANY (ARRAY['single'::text, 'id'::text, 'nearest'::text, 'none'::text, 'unplaced'::text])))),
    CONSTRAINT los_sites_source_registered CHECK ((source_feed = 'los_nrw_sites'::text))
);

CREATE VIEW public.los_lane_now_live AS
 SELECT t.lane_id,
    t.site_id,
    c.road,
    c.direction,
    c.geom,
    t.status,
    t.measured_at,
    t.last_seen_at
   FROM ((public.los_lane_state t
     JOIN public.los_lane_sites s ON ((s.lane_id = t.lane_id)))
     JOIN public.los_sites c ON ((c.site_id = t.site_id)))
  WHERE ((s.closed_at IS NULL) AND (c.closed_at IS NULL) AND (c.carriageway = 'hfb'::text) AND (c.road IS NOT NULL) AND (c.geom IS NOT NULL) AND (COALESCE(s.confidentiality, 'noRestriction'::text) = 'noRestriction'::text) AND (COALESCE(t.confidentiality, 'noRestriction'::text) = 'noRestriction'::text) AND (COALESCE(c.confidentiality, 'noRestriction'::text) = 'noRestriction'::text));

CREATE TABLE public.los_state (
    site_id text NOT NULL,
    status text NOT NULL,
    measured_at timestamp with time zone,
    status_since timestamp with time zone NOT NULL,
    last_seen_at timestamp with time zone NOT NULL,
    confidentiality text,
    source_feed text NOT NULL,
    source_publisher text NOT NULL,
    source_run_id bigint,
    provider_updated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT los_state_source_registered CHECK ((source_feed = 'los_nrw'::text))
);

CREATE VIEW public.los_now_live AS
 SELECT s.site_id,
    s.road,
    s.direction,
    s.section,
    s.geom,
    t.status,
    t.measured_at,
    t.status_since,
    t.last_seen_at
   FROM (public.los_sites s
     JOIN public.los_state t ON ((t.site_id = s.site_id)))
  WHERE ((s.closed_at IS NULL) AND (s.carriageway = 'hfb'::text) AND (s.road IS NOT NULL) AND (s.geom IS NOT NULL) AND (COALESCE(s.confidentiality, 'noRestriction'::text) = 'noRestriction'::text) AND (COALESCE(t.confidentiality, 'noRestriction'::text) = 'noRestriction'::text));

CREATE VIEW public.los_sites_live AS
 SELECT site_id,
    section,
    carriageway,
    direction,
    geom,
    road,
    road_rule,
    first_seen_at,
    last_seen_at,
    source_feed
   FROM public.los_sites
  WHERE ((closed_at IS NULL) AND (COALESCE(confidentiality, 'noRestriction'::text) = 'noRestriction'::text));

CREATE TABLE public.los_ticks (
    observed_at timestamp with time zone NOT NULL,
    site_id text NOT NULL,
    status text NOT NULL,
    previous_status text,
    measured_at timestamp with time zone,
    confidentiality text,
    source_run_id bigint
)
PARTITION BY RANGE (observed_at);

CREATE TABLE public.mcp_usage (
    period text NOT NULL,
    period_start timestamp with time zone NOT NULL,
    door text NOT NULL,
    rpc text NOT NULL,
    tool text DEFAULT ''::text NOT NULL,
    client text NOT NULL,
    requests bigint DEFAULT 0 NOT NULL,
    errors bigint DEFAULT 0 NOT NULL,
    sessions bigint DEFAULT 0 NOT NULL,
    total_ms bigint DEFAULT 0 NOT NULL,
    ms_le_100 bigint DEFAULT 0 NOT NULL,
    ms_le_250 bigint DEFAULT 0 NOT NULL,
    ms_le_500 bigint DEFAULT 0 NOT NULL,
    ms_le_1000 bigint DEFAULT 0 NOT NULL,
    ms_le_2500 bigint DEFAULT 0 NOT NULL,
    ms_le_5000 bigint DEFAULT 0 NOT NULL,
    ms_le_10000 bigint DEFAULT 0 NOT NULL,
    ms_gt_10000 bigint DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    refusals bigint DEFAULT 0 NOT NULL,
    tool_errors bigint DEFAULT 0 NOT NULL,
    server_errors bigint DEFAULT 0 NOT NULL,
    tool_error_invalid_input bigint DEFAULT 0 NOT NULL,
    tool_error_not_found bigint DEFAULT 0 NOT NULL,
    tool_error_out_of_coverage bigint DEFAULT 0 NOT NULL,
    tool_error_unavailable bigint DEFAULT 0 NOT NULL,
    tool_error_limit_reached bigint DEFAULT 0 NOT NULL,
    tool_error_timeout bigint DEFAULT 0 NOT NULL,
    tool_error_internal bigint DEFAULT 0 NOT NULL,
    CONSTRAINT mcp_usage_client_check CHECK ((client ~ '^[a-z0-9][a-z0-9._-]{0,39}$'::text)),
    CONSTRAINT mcp_usage_door_check CHECK ((door = ANY (ARRAY['streamable'::text, 'sse'::text]))),
    CONSTRAINT mcp_usage_errors_check CHECK ((errors >= 0)),
    CONSTRAINT mcp_usage_period_aligned CHECK (((period_start AT TIME ZONE 'UTC'::text) = date_trunc(period, (period_start AT TIME ZONE 'UTC'::text)))),
    CONSTRAINT mcp_usage_period_check CHECK ((period = ANY (ARRAY['hour'::text, 'day'::text]))),
    CONSTRAINT mcp_usage_refusals_check CHECK ((refusals >= 0)),
    CONSTRAINT mcp_usage_requests_check CHECK ((requests >= 0)),
    CONSTRAINT mcp_usage_rpc_check CHECK ((rpc ~ '^[A-Za-z][A-Za-z0-9_/.-]{0,63}$'::text)),
    CONSTRAINT mcp_usage_server_errors_check CHECK ((server_errors >= 0)),
    CONSTRAINT mcp_usage_sessions_check CHECK ((sessions >= 0)),
    CONSTRAINT mcp_usage_tool_check CHECK ((tool ~ '^([a-z][a-z0-9_]{0,63})?$'::text)),
    CONSTRAINT mcp_usage_tool_error_internal_check CHECK ((tool_error_internal >= 0)),
    CONSTRAINT mcp_usage_tool_error_invalid_input_check CHECK ((tool_error_invalid_input >= 0)),
    CONSTRAINT mcp_usage_tool_error_limit_reached_check CHECK ((tool_error_limit_reached >= 0)),
    CONSTRAINT mcp_usage_tool_error_not_found_check CHECK ((tool_error_not_found >= 0)),
    CONSTRAINT mcp_usage_tool_error_out_of_coverage_check CHECK ((tool_error_out_of_coverage >= 0)),
    CONSTRAINT mcp_usage_tool_error_timeout_check CHECK ((tool_error_timeout >= 0)),
    CONSTRAINT mcp_usage_tool_error_unavailable_check CHECK ((tool_error_unavailable >= 0)),
    CONSTRAINT mcp_usage_tool_errors_check CHECK ((tool_errors >= 0)),
    CONSTRAINT mcp_usage_total_ms_check CHECK ((total_ms >= 0))
);

CREATE TABLE public.mcp_usage_exports (
    destination text NOT NULL,
    day date NOT NULL,
    state text NOT NULL,
    attempts integer DEFAULT 1 NOT NULL,
    claimed_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    http_status integer,
    totals jsonb DEFAULT '{}'::jsonb NOT NULL,
    error text,
    CONSTRAINT mcp_usage_exports_attempts_check CHECK ((attempts >= 1)),
    CONSTRAINT mcp_usage_exports_destination_check CHECK ((destination = 'ga4'::text)),
    CONSTRAINT mcp_usage_exports_error_check CHECK ((length(error) <= 500)),
    CONSTRAINT mcp_usage_exports_finished CHECK (((state = 'claimed'::text) = (finished_at IS NULL))),
    CONSTRAINT mcp_usage_exports_http_status_check CHECK (((http_status >= 100) AND (http_status <= 599))),
    CONSTRAINT mcp_usage_exports_state_check CHECK ((state = ANY (ARRAY['claimed'::text, 'sent'::text, 'failed'::text]))),
    CONSTRAINT mcp_usage_exports_totals_check CHECK ((jsonb_typeof(totals) = 'object'::text))
);

CREATE TABLE public.tmc_locations (
    cid smallint NOT NULL,
    tabcd smallint NOT NULL,
    lcd integer NOT NULL,
    lcl_version text NOT NULL,
    class text NOT NULL,
    tcd smallint NOT NULL,
    stcd smallint NOT NULL,
    junction_no text,
    name text,
    road_number text,
    road_lcd integer,
    segment_lcd integer,
    neg_off_lcd integer,
    pos_off_lcd integer,
    geom public.geography(Point,4326) NOT NULL,
    loaded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tmc_locations_point CHECK ((class = 'P'::text)),
    CONSTRAINT tmc_locations_version_shape CHECK ((lcl_version ~ '^[0-9]+\.[0-9]+$'::text))
);

CREATE VIEW public.motorway_points_live AS
 SELECT road_number AS road,
    lcd,
    tcd,
    stcd,
    junction_no,
    name,
    neg_off_lcd,
    pos_off_lcd,
    geom
   FROM public.tmc_locations t
  WHERE ((cid = 58) AND (tabcd = 1) AND (road_number ~ '^A[1-9][0-9]{0,2}$'::text));

CREATE VIEW public.motorway_register_live AS
 SELECT road
   FROM ( SELECT t.road_number AS road
           FROM public.tmc_locations t
          WHERE ((t.cid = 58) AND (t.tabcd = 1) AND (t.road_number ~ '^A[1-9][0-9]{0,2}$'::text))
        UNION
         SELECT r.road
           FROM public.autobahn_roads r
          WHERE (r.road ~ '^A[1-9][0-9]{0,2}$'::text)) u;

CREATE TABLE public.motorway_summary (
    road text NOT NULL,
    refreshed_at timestamp with time zone NOT NULL,
    read_at timestamp with time zone,
    tick timestamp with time zone,
    closures integer NOT NULL,
    jams integer NOT NULL,
    warnings integer NOT NULL,
    roadworks integer NOT NULL,
    by_direction jsonb,
    worst jsonb,
    next_closure jsonb,
    sources text[] DEFAULT '{}'::text[] NOT NULL,
    page_listing jsonb,
    page_warnings jsonb,
    CONSTRAINT motorway_summary_closures_check CHECK ((closures >= 0)),
    CONSTRAINT motorway_summary_jams_check CHECK ((jams >= 0)),
    CONSTRAINT motorway_summary_road_check CHECK ((road ~ '^A[1-9][0-9]{0,2}$'::text)),
    CONSTRAINT motorway_summary_roadworks_check CHECK ((roadworks >= 0)),
    CONSTRAINT motorway_summary_warnings_check CHECK ((warnings >= 0))
);

CREATE VIEW public.motorway_summary_live AS
 SELECT road,
    refreshed_at,
    read_at,
    tick,
    closures,
    jams,
    warnings,
    roadworks,
    by_direction,
    worst,
    next_closure,
    sources,
    page_listing,
    page_warnings
   FROM public.motorway_summary s;

CREATE TABLE public.mvv_bus_load (
    source_feed text DEFAULT 'mvv_bus_load'::text NOT NULL,
    source_publisher text DEFAULT 'Münchner Verkehrs- und Tarifverbund GmbH (MVV)'::text NOT NULL,
    day_type text NOT NULL,
    dhid text NOT NULL,
    line text NOT NULL,
    direction smallint NOT NULL,
    dep_time text NOT NULL,
    load_class smallint NOT NULL,
    file_rows integer NOT NULL,
    release_year smallint,
    first_seen_at timestamp with time zone NOT NULL,
    last_seen_at timestamp with time zone NOT NULL,
    closed_at timestamp with time zone,
    provider_updated_at timestamp with time zone,
    source_run_id bigint,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT mvv_bus_load_class CHECK (((load_class >= 1) AND (load_class <= 4))),
    CONSTRAINT mvv_bus_load_day CHECK ((day_type = ANY (ARRAY['MFS'::text, 'MFF'::text, 'Sa'::text, 'So'::text]))),
    CONSTRAINT mvv_bus_load_feed CHECK ((source_feed = 'mvv_bus_load'::text)),
    CONSTRAINT mvv_bus_load_rows CHECK ((file_rows >= 1)),
    CONSTRAINT mvv_bus_load_time CHECK ((dep_time ~ '^[0-2][0-9]:[0-5][0-9]$'::text))
);

CREATE VIEW public.mvv_bus_load_live AS
 SELECT day_type,
    dhid,
    line,
    direction,
    dep_time,
    load_class,
    release_year,
    provider_updated_at
   FROM public.mvv_bus_load l
  WHERE (closed_at IS NULL);

CREATE TABLE public.oom_kills (
    id bigint NOT NULL,
    killed_at timestamp with time zone NOT NULL,
    victim text NOT NULL,
    constraint_kind text NOT NULL,
    container text,
    process text,
    anon_rss_kb bigint,
    limit_kb bigint,
    line_sha256 text NOT NULL,
    collected_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT oom_kills_anon_rss_kb_check CHECK ((anon_rss_kb >= 0)),
    CONSTRAINT oom_kills_constraint_kind_check CHECK ((constraint_kind = ANY (ARRAY['memcg'::text, 'global'::text]))),
    CONSTRAINT oom_kills_container_check CHECK ((container ~ '^viafrei-[a-z0-9][a-z0-9-]{0,62}$'::text)),
    CONSTRAINT oom_kills_limit_kb_check CHECK ((limit_kb > 0)),
    CONSTRAINT oom_kills_line_sha256_check CHECK ((line_sha256 ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT oom_kills_names_only_ours CHECK (((victim = 'ours'::text) OR ((container IS NULL) AND (process IS NULL) AND (anon_rss_kb IS NULL) AND (limit_kb IS NULL)))),
    CONSTRAINT oom_kills_other_only_global CHECK (((victim <> 'other'::text) OR (constraint_kind = 'global'::text))),
    CONSTRAINT oom_kills_ours_is_named CHECK (((victim <> 'ours'::text) OR (container IS NOT NULL))),
    CONSTRAINT oom_kills_process_check CHECK ((process ~ '^[A-Za-z0-9._:-]{1,15}$'::text)),
    CONSTRAINT oom_kills_victim_check CHECK ((victim = ANY (ARRAY['ours'::text, 'other'::text, 'unknown'::text])))
);

ALTER TABLE public.oom_kills ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.oom_kills_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.opendata_roadwork_versions (
    source_feed text NOT NULL,
    site_id text NOT NULL,
    content_hash text NOT NULL,
    observed_at timestamp with time zone NOT NULL,
    provider_updated_at timestamp with time zone,
    starts_at timestamp with time zone,
    ends_at timestamp with time zone,
    props jsonb NOT NULL,
    geom public.geometry(Geometry,4326) NOT NULL,
    source_run_id bigint
);

CREATE TABLE public.opendata_roadworks (
    source_feed text NOT NULL,
    source_publisher text NOT NULL,
    site_id text NOT NULL,
    kind text NOT NULL,
    title text NOT NULL,
    place_text text,
    detail_text text,
    road_number text,
    organisation text,
    closure boolean DEFAULT false NOT NULL,
    affects_traffic boolean DEFAULT true NOT NULL,
    answerable boolean DEFAULT true NOT NULL,
    starts_at timestamp with time zone,
    ends_at timestamp with time zone,
    day_precision boolean DEFAULT false NOT NULL,
    period_text text,
    planned_layer boolean DEFAULT false NOT NULL,
    link text,
    props jsonb NOT NULL,
    geom public.geometry(Geometry,4326) NOT NULL,
    anchor public.geometry(Point,4326) NOT NULL,
    content_hash text NOT NULL,
    first_seen_at timestamp with time zone NOT NULL,
    last_seen_at timestamp with time zone NOT NULL,
    closed_at timestamp with time zone,
    source_run_id bigint,
    provider_updated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    closure_starts_at timestamp with time zone,
    closure_ends_at timestamp with time zone,
    closure_window_rule smallint,
    CONSTRAINT opendata_roadworks_closure_window_ordered CHECK (((closure_starts_at IS NULL) OR (closure_ends_at IS NULL) OR (closure_starts_at < closure_ends_at))),
    CONSTRAINT opendata_roadworks_kind_known CHECK ((kind = ANY (ARRAY['roadworks'::text, 'event'::text, 'message'::text]))),
    CONSTRAINT opendata_roadworks_period_ordered CHECK (((starts_at IS NULL) OR (ends_at IS NULL) OR (starts_at <= ends_at)))
);

CREATE VIEW public.opendata_roadworks_live AS
 SELECT source_feed,
    site_id,
    kind,
    title,
    place_text,
    detail_text,
    road_number,
    organisation,
    closure,
    starts_at,
    ends_at,
    day_precision,
    period_text,
    planned_layer,
    link,
    geom,
    anchor,
    first_seen_at,
    last_seen_at,
    provider_updated_at,
    closure_starts_at,
    closure_ends_at
   FROM public.opendata_roadworks
  WHERE ((closed_at IS NULL) AND answerable AND affects_traffic);

CREATE TABLE public.ops_audit (
    id bigint NOT NULL,
    at timestamp with time zone DEFAULT now() NOT NULL,
    actor text NOT NULL,
    action text NOT NULL,
    target text NOT NULL,
    before text,
    after text,
    result text NOT NULL,
    client_ip text,
    CONSTRAINT ops_audit_action_check CHECK ((action = ANY (ARRAY['login'::text, 'login-refused'::text, 'restart'::text, 'config'::text, 'refused'::text, 'passkey-add'::text, 'passkey-remove'::text, 'run-now'::text, 'pause'::text, 'resume'::text]))),
    CONSTRAINT ops_audit_actor_check CHECK ((actor ~ '^[a-z][a-z0-9_-]{0,31}$'::text)),
    CONSTRAINT ops_audit_after_check CHECK (((after IS NULL) OR (length(after) <= 200))),
    CONSTRAINT ops_audit_before_check CHECK (((before IS NULL) OR (length(before) <= 200))),
    CONSTRAINT ops_audit_client_ip_check CHECK (((client_ip IS NULL) OR (length(client_ip) <= 45))),
    CONSTRAINT ops_audit_result_check CHECK ((result ~ '^[a-z][a-z-]{0,31}$'::text)),
    CONSTRAINT ops_audit_target_check CHECK (((length(target) >= 1) AND (length(target) <= 120)))
);

ALTER TABLE public.ops_audit ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.ops_audit_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.ops_passkeys (
    id bigint NOT NULL,
    credential_id bytea NOT NULL,
    public_key bytea NOT NULL,
    sign_count bigint DEFAULT 0 NOT NULL,
    transports text[] DEFAULT '{}'::text[] NOT NULL,
    label text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_used_at timestamp with time zone,
    CONSTRAINT ops_passkeys_credential_id_check CHECK (((length(credential_id) >= 1) AND (length(credential_id) <= 1023))),
    CONSTRAINT ops_passkeys_label_check CHECK (((label ~ '^[^[:cntrl:]]{1,40}$'::text) AND (label = btrim(label)))),
    CONSTRAINT ops_passkeys_public_key_check CHECK (((length(public_key) >= 16) AND (length(public_key) <= 4096))),
    CONSTRAINT ops_passkeys_sign_count_check CHECK (((sign_count >= 0) AND (sign_count <= '4294967295'::bigint))),
    CONSTRAINT ops_passkeys_transports_check CHECK ((transports <@ ARRAY['ble'::text, 'cable'::text, 'hybrid'::text, 'internal'::text, 'nfc'::text, 'smart-card'::text, 'usb'::text]))
);

ALTER TABLE public.ops_passkeys ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.ops_passkeys_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.ops_requests (
    id bigint NOT NULL,
    requested_at timestamp with time zone DEFAULT now() NOT NULL,
    action text NOT NULL,
    target text NOT NULL,
    requested_by text NOT NULL,
    state text DEFAULT 'pending'::text NOT NULL,
    handled_at timestamp with time zone,
    result text,
    CONSTRAINT ops_requests_action_check CHECK ((action = ANY (ARRAY['restart'::text, 'run-now'::text]))),
    CONSTRAINT ops_requests_requested_by_check CHECK ((requested_by ~ '^[a-z][a-z0-9_-]{0,31}$'::text)),
    CONSTRAINT ops_requests_result_check CHECK (((result IS NULL) OR (result ~ '^[a-z][a-z-]{0,31}$'::text))),
    CONSTRAINT ops_requests_state_check CHECK ((state = ANY (ARRAY['pending'::text, 'done'::text, 'failed'::text, 'refused'::text]))),
    CONSTRAINT ops_requests_target_check CHECK (
CASE action
    WHEN 'restart'::text THEN (target = ANY (ARRAY['ingest-autobahn'::text, 'ingest-tankerkoenig'::text, 'ingest-mobilithek'::text, 'ingest-dwd'::text, 'ingest-vbb-rt'::text, 'ingest-db-fasta'::text, 'ingest-gtfs-roll'::text, 'ingest-gtfs-fetch'::text, 'ingest-zhv'::text, 'ingest-bnetza'::text, 'ingest-ocpdb'::text, 'ingest-hamburg'::text, 'ingest-gbfs'::text, 'mcp'::text, 'digest'::text, 'web'::text, 'status'::text]))
    WHEN 'run-now'::text THEN (target ~ '^[a-z][a-z0-9_]{0,63}$'::text)
    ELSE false
END)
);

ALTER TABLE public.ops_requests ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.ops_requests_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.ops_rollup_daily (
    day date NOT NULL,
    ledger text NOT NULL,
    key text NOT NULL,
    runs integer NOT NULL,
    ok integer NOT NULL,
    unchanged integer NOT NULL,
    degraded integer NOT NULL,
    error integer NOT NULL,
    quiet integer NOT NULL,
    items_seen bigint NOT NULL,
    items_inserted bigint NOT NULL,
    items_updated bigint NOT NULL,
    items_closed bigint NOT NULL,
    buckets_with_runs integer NOT NULL,
    buckets_with_success integer NOT NULL,
    last_success_at timestamp with time zone,
    computed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ops_rollup_daily_key_check CHECK ((key ~ '^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,79}$'::text)),
    CONSTRAINT ops_rollup_daily_ledger_check CHECK ((ledger = ANY (ARRAY['feed'::text, 'ingest'::text])))
);

CREATE TABLE public.ops_rollup_feed (
    bucket_day date NOT NULL,
    bucket_start timestamp with time zone NOT NULL,
    ledger text NOT NULL,
    key text NOT NULL,
    runs integer NOT NULL,
    ok integer DEFAULT 0 NOT NULL,
    unchanged integer DEFAULT 0 NOT NULL,
    degraded integer DEFAULT 0 NOT NULL,
    error integer DEFAULT 0 NOT NULL,
    quiet integer DEFAULT 0 NOT NULL,
    running integer DEFAULT 0 NOT NULL,
    items_seen bigint DEFAULT 0 NOT NULL,
    items_inserted bigint DEFAULT 0 NOT NULL,
    items_updated bigint DEFAULT 0 NOT NULL,
    items_closed bigint DEFAULT 0 NOT NULL,
    duration_ms_sum bigint DEFAULT 0 NOT NULL,
    duration_n integer DEFAULT 0 NOT NULL,
    last_started_at timestamp with time zone NOT NULL,
    last_status text NOT NULL,
    last_success_at timestamp with time zone,
    computed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ops_rollup_feed_aligned CHECK ((((EXTRACT(epoch FROM bucket_start))::bigint % (300)::bigint) = 0)),
    CONSTRAINT ops_rollup_feed_day CHECK ((bucket_day = ((bucket_start AT TIME ZONE 'UTC'::text))::date)),
    CONSTRAINT ops_rollup_feed_key_check CHECK ((key ~ '^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,79}$'::text)),
    CONSTRAINT ops_rollup_feed_ledger_check CHECK ((ledger = ANY (ARRAY['feed'::text, 'ingest'::text]))),
    CONSTRAINT ops_rollup_feed_runs_check CHECK ((runs > 0))
)
PARTITION BY LIST (bucket_day);

CREATE TABLE public.ops_rollup_held (
    day date NOT NULL,
    kind text NOT NULL,
    approx_rows bigint NOT NULL,
    computed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ops_rollup_held_approx_rows_check CHECK ((approx_rows >= 0)),
    CONSTRAINT ops_rollup_held_kind_check CHECK ((kind ~ '^[a-z][a-z_]{0,39}$'::text))
);

CREATE TABLE public.ops_rollup_usage (
    day date NOT NULL,
    tool text NOT NULL,
    class text NOT NULL,
    calls bigint DEFAULT 0 NOT NULL,
    errors bigint DEFAULT 0 NOT NULL,
    ms_le_100 bigint DEFAULT 0 NOT NULL,
    ms_le_250 bigint DEFAULT 0 NOT NULL,
    ms_le_500 bigint DEFAULT 0 NOT NULL,
    ms_le_1000 bigint DEFAULT 0 NOT NULL,
    ms_le_2500 bigint DEFAULT 0 NOT NULL,
    ms_le_5000 bigint DEFAULT 0 NOT NULL,
    ms_le_10000 bigint DEFAULT 0 NOT NULL,
    ms_gt_10000 bigint DEFAULT 0 NOT NULL,
    computed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ops_rollup_usage_class_check CHECK ((class = ANY (ARRAY['real'::text, 'scanners'::text, 'own'::text]))),
    CONSTRAINT ops_rollup_usage_tool_check CHECK ((tool ~ '^([a-z][a-z0-9_]{0,63}|other)$'::text))
);

CREATE TABLE public.osm_addresses (
    id bigint NOT NULL,
    osm_type text NOT NULL,
    osm_id bigint NOT NULL,
    street text NOT NULL,
    house_number text NOT NULL,
    postcode text,
    place text,
    street_norm text NOT NULL,
    house_number_norm text NOT NULL,
    place_norm text,
    geom public.geography(Point,4326) NOT NULL,
    source_id text DEFAULT 'osm'::text NOT NULL,
    extract_date date NOT NULL,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    closed_at timestamp with time zone,
    land text,
    CONSTRAINT osm_addresses_locatable CHECK (((place_norm IS NOT NULL) OR (postcode IS NOT NULL))),
    CONSTRAINT osm_addresses_source_is_osm CHECK ((source_id = 'osm'::text)),
    CONSTRAINT osm_addresses_type_known CHECK ((osm_type = ANY (ARRAY['node'::text, 'way'::text, 'relation'::text])))
);

ALTER TABLE public.osm_addresses ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.osm_addresses_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE VIEW public.osm_addresses_live AS
 SELECT street,
    house_number,
    postcode,
    place,
    street_norm,
    house_number_norm,
    place_norm,
    geom,
    extract_date
   FROM public.osm_addresses a
  WHERE (closed_at IS NULL);

CREATE TABLE public.osm_boundary_de (
    id bigint NOT NULL,
    land text NOT NULL,
    osm_id bigint NOT NULL,
    osm_version integer NOT NULL,
    part integer NOT NULL,
    geom public.geometry(Polygon,4326) NOT NULL,
    source_id text DEFAULT 'osm'::text NOT NULL,
    extract_date date NOT NULL,
    loaded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT osm_boundary_de_geom_valid CHECK ((public.st_isvalid(geom) AND (NOT public.st_isempty(geom)))),
    CONSTRAINT osm_boundary_de_land_known CHECK ((land = ANY (ARRAY['baden-wuerttemberg'::text, 'bayern'::text, 'berlin'::text, 'brandenburg'::text, 'bremen'::text, 'hamburg'::text, 'hessen'::text, 'mecklenburg-vorpommern'::text, 'niedersachsen'::text, 'nordrhein-westfalen'::text, 'rheinland-pfalz'::text, 'saarland'::text, 'sachsen'::text, 'sachsen-anhalt'::text, 'schleswig-holstein'::text, 'thueringen'::text]))),
    CONSTRAINT osm_boundary_de_part_positive CHECK ((part >= 1)),
    CONSTRAINT osm_boundary_de_source_is_osm CHECK ((source_id = 'osm'::text))
);

ALTER TABLE public.osm_boundary_de ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.osm_boundary_de_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.osm_pois (
    id bigint NOT NULL,
    osm_type text NOT NULL,
    osm_id bigint NOT NULL,
    name text NOT NULL,
    name_norm text NOT NULL,
    category text NOT NULL,
    category_value text NOT NULL,
    brand text,
    operator text,
    street text,
    house_number text,
    postcode text,
    place text,
    place_norm text,
    geom public.geography(Point,4326) NOT NULL,
    source_id text DEFAULT 'osm'::text NOT NULL,
    extract_date date NOT NULL,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    closed_at timestamp with time zone,
    land text,
    access text,
    CONSTRAINT osm_pois_category_known CHECK ((category = ANY (ARRAY['office'::text, 'amenity'::text, 'shop'::text, 'tourism'::text, 'healthcare'::text, 'leisure'::text, 'industrial'::text, 'historic'::text, 'natural'::text, 'highway'::text, 'building'::text, 'railway'::text]))),
    CONSTRAINT osm_pois_category_value_not_blank CHECK ((category_value <> ''::text)),
    CONSTRAINT osm_pois_name_not_blank CHECK (((name <> ''::text) AND (name_norm <> ''::text))),
    CONSTRAINT osm_pois_source_is_osm CHECK ((source_id = 'osm'::text)),
    CONSTRAINT osm_pois_type_known CHECK ((osm_type = ANY (ARRAY['node'::text, 'way'::text, 'relation'::text])))
);

ALTER TABLE public.osm_pois ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.osm_pois_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE VIEW public.osm_pois_live AS
 SELECT name,
    category,
    category_value,
    street,
    house_number,
    geom,
    extract_date,
    access,
    id,
    name_norm,
    place,
    place_norm
   FROM public.osm_pois p
  WHERE (closed_at IS NULL);

CREATE TABLE public.osm_replication_state (
    land text NOT NULL,
    sequence bigint NOT NULL,
    sequence_timestamp timestamp with time zone NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL,
    source text NOT NULL,
    extract_date date,
    CONSTRAINT osm_replication_state_sequence_positive CHECK ((sequence > 0)),
    CONSTRAINT osm_replication_state_source_known CHECK ((source = ANY (ARRAY['baseline'::text, 'diff'::text])))
);

CREATE TABLE public.osm_speed_cameras (
    id bigint NOT NULL,
    osm_type text DEFAULT 'node'::text NOT NULL,
    osm_id bigint NOT NULL,
    enforces text DEFAULT 'speed'::text NOT NULL,
    geom public.geography(Point,4326) NOT NULL,
    max_speed_kmh smallint,
    direction text,
    name text,
    tags jsonb DEFAULT '{}'::jsonb NOT NULL,
    source_id text DEFAULT 'osm_speed_cameras'::text NOT NULL,
    land text,
    extract_date date NOT NULL,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone NOT NULL,
    closed_at timestamp with time zone,
    CONSTRAINT osm_speed_cameras_enforces CHECK ((enforces = ANY (ARRAY['speed'::text, 'red_light'::text, 'speed_red_light'::text]))),
    CONSTRAINT osm_speed_cameras_land_known CHECK (((land IS NULL) OR (land = ANY (ARRAY['baden-wuerttemberg'::text, 'bayern'::text, 'berlin'::text, 'brandenburg'::text, 'bremen'::text, 'hamburg'::text, 'hessen'::text, 'mecklenburg-vorpommern'::text, 'niedersachsen'::text, 'nordrhein-westfalen'::text, 'rheinland-pfalz'::text, 'saarland'::text, 'sachsen'::text, 'sachsen-anhalt'::text, 'schleswig-holstein'::text, 'thueringen'::text, 'germany'::text])))),
    CONSTRAINT osm_speed_cameras_node CHECK ((osm_type = 'node'::text)),
    CONSTRAINT osm_speed_cameras_source CHECK ((source_id = 'osm_speed_cameras'::text)),
    CONSTRAINT osm_speed_cameras_speed CHECK (((max_speed_kmh IS NULL) OR ((max_speed_kmh >= 5) AND (max_speed_kmh <= 200))))
);

ALTER TABLE public.osm_speed_cameras ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.osm_speed_cameras_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE VIEW public.osm_speed_cameras_live AS
 SELECT id,
    osm_type,
    osm_id,
    enforces,
    geom,
    max_speed_kmh,
    direction,
    name,
    tags,
    source_id,
    land,
    extract_date,
    first_seen_at,
    last_seen_at,
    closed_at
   FROM public.osm_speed_cameras
  WHERE (closed_at IS NULL);

CREATE TABLE public.osm_streets (
    id bigint NOT NULL,
    osm_type text DEFAULT 'way'::text NOT NULL,
    osm_id bigint NOT NULL,
    cls smallint NOT NULL,
    geom public.geometry(LineString,25832) NOT NULL,
    geom_lo public.geometry(LineString,25832),
    source_id text DEFAULT 'osm_streets'::text NOT NULL,
    land text,
    extract_date date NOT NULL,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone NOT NULL,
    closed_at timestamp with time zone,
    CONSTRAINT osm_streets_cls CHECK (((cls >= 1) AND (cls <= 6))),
    CONSTRAINT osm_streets_land_known CHECK (((land IS NULL) OR (land = ANY (ARRAY['baden-wuerttemberg'::text, 'bayern'::text, 'berlin'::text, 'brandenburg'::text, 'bremen'::text, 'hamburg'::text, 'hessen'::text, 'mecklenburg-vorpommern'::text, 'niedersachsen'::text, 'nordrhein-westfalen'::text, 'rheinland-pfalz'::text, 'saarland'::text, 'sachsen'::text, 'sachsen-anhalt'::text, 'schleswig-holstein'::text, 'thueringen'::text, 'germany'::text])))),
    CONSTRAINT osm_streets_lo_band CHECK (((cls <= 4) = (geom_lo IS NOT NULL))),
    CONSTRAINT osm_streets_source_is_osm CHECK ((source_id = 'osm_streets'::text)),
    CONSTRAINT osm_streets_way CHECK ((osm_type = 'way'::text))
);

CREATE MATERIALIZED VIEW public.osm_street_tiles AS
 SELECT cls,
    (floor(((public.st_xmin((geom)::public.box3d) + public.st_xmax((geom)::public.box3d)) / (2000)::double precision)))::integer AS tx,
    (floor(((public.st_ymin((geom)::public.box3d) + public.st_ymax((geom)::public.box3d)) / (2000)::double precision)))::integer AS ty,
    (count(*))::integer AS ways,
    (public.st_collect(geom))::public.geometry(MultiLineString,25832) AS geom
   FROM public.osm_streets s
  WHERE ((closed_at IS NULL) AND (cls >= 2))
  GROUP BY cls, ((floor(((public.st_xmin((geom)::public.box3d) + public.st_xmax((geom)::public.box3d)) / (2000)::double precision)))::integer), ((floor(((public.st_ymin((geom)::public.box3d) + public.st_ymax((geom)::public.box3d)) / (2000)::double precision)))::integer)
  WITH NO DATA;

CREATE MATERIALIZED VIEW public.osm_street_tiles_lo AS
 SELECT cls,
    (floor(((public.st_xmin((geom_lo)::public.box3d) + public.st_xmax((geom_lo)::public.box3d)) / (20000)::double precision)))::integer AS tx,
    (floor(((public.st_ymin((geom_lo)::public.box3d) + public.st_ymax((geom_lo)::public.box3d)) / (20000)::double precision)))::integer AS ty,
    (count(*))::integer AS ways,
    (public.st_collect(geom_lo))::public.geometry(MultiLineString,25832) AS geom
   FROM public.osm_streets s
  WHERE ((closed_at IS NULL) AND ((cls >= 2) AND (cls <= 4)) AND (geom_lo IS NOT NULL))
  GROUP BY cls, ((floor(((public.st_xmin((geom_lo)::public.box3d) + public.st_xmax((geom_lo)::public.box3d)) / (20000)::double precision)))::integer), ((floor(((public.st_ymin((geom_lo)::public.box3d) + public.st_ymax((geom_lo)::public.box3d)) / (20000)::double precision)))::integer)
  ORDER BY cls, ((floor(((public.st_ymin((geom_lo)::public.box3d) + public.st_ymax((geom_lo)::public.box3d)) / (20000)::double precision)))::integer), ((floor(((public.st_xmin((geom_lo)::public.box3d) + public.st_xmax((geom_lo)::public.box3d)) / (20000)::double precision)))::integer)
  WITH NO DATA;

ALTER TABLE public.osm_streets ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.osm_streets_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.parkapi_stray_latch (
    feed_key text NOT NULL,
    tripped_at timestamp with time zone NOT NULL,
    reason text,
    set_at timestamp with time zone DEFAULT now() NOT NULL,
    cleared_at timestamp with time zone,
    CONSTRAINT parkapi_stray_latch_cleared CHECK (((cleared_at IS NULL) OR (cleared_at >= tripped_at))),
    CONSTRAINT parkapi_stray_latch_feed_key_check CHECK ((feed_key = 'parkapi_bw'::text)),
    CONSTRAINT parkapi_stray_latch_reason_check CHECK (((reason IS NULL) OR (length(reason) <= 200)))
);

CREATE TABLE public.parking_facilities (
    id bigint NOT NULL,
    source_feed text NOT NULL,
    external_id text NOT NULL,
    kind text NOT NULL,
    name text,
    operator text,
    road text,
    capacity_total integer,
    capacity_truck integer,
    capacity_disabled integer,
    geom public.geography(Point,4326) NOT NULL,
    address jsonb,
    opening jsonb,
    attribution_id text NOT NULL,
    source_version text,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    closed_at timestamp with time zone,
    source_publisher text,
    source_run_id bigint,
    provider_updated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    deleted_reason text,
    deleted_run_id bigint,
    station_ref text,
    station_name text,
    station_name_norm text,
    confidentiality text,
    facilities text[] DEFAULT '{}'::text[] NOT NULL,
    facilities_absent text[] DEFAULT '{}'::text[] NOT NULL,
    facilities_extra text[] DEFAULT '{}'::text[] NOT NULL,
    facilities_source text,
    CONSTRAINT parking_facilities_attribution CHECK (((attribution_id <> ''::text) AND (attribution_id !~~ '%\_pending'::text))),
    CONSTRAINT parking_facilities_capacity CHECK (((COALESCE(capacity_total, 0) >= 0) AND (COALESCE(capacity_truck, 0) >= 0) AND (COALESCE(capacity_disabled, 0) >= 0))),
    CONSTRAINT parking_facilities_facilities_absent_vocabulary CHECK ((facilities_absent <@ ARRAY['toilet'::text, 'accessible_toilet'::text, 'shower'::text, 'restaurant'::text, 'snack'::text, 'cafe'::text, 'shop'::text, 'fuel'::text, 'charging'::text, 'drinking_water'::text, 'picnic'::text, 'playground'::text, 'wifi'::text, 'security'::text])),
    CONSTRAINT parking_facilities_facilities_disjoint CHECK ((NOT (facilities && facilities_absent))),
    CONSTRAINT parking_facilities_facilities_source CHECK (((facilities_source IS NULL) = ((cardinality(facilities) = 0) AND (cardinality(facilities_absent) = 0)))),
    CONSTRAINT parking_facilities_facilities_source_nonempty CHECK (((facilities_source IS NULL) OR (facilities_source <> ''::text))),
    CONSTRAINT parking_facilities_facilities_vocabulary CHECK ((facilities <@ ARRAY['toilet'::text, 'accessible_toilet'::text, 'shower'::text, 'restaurant'::text, 'snack'::text, 'cafe'::text, 'shop'::text, 'fuel'::text, 'charging'::text, 'drinking_water'::text, 'picnic'::text, 'playground'::text, 'wifi'::text, 'security'::text])),
    CONSTRAINT parking_facilities_kind CHECK ((kind = ANY (ARRAY['rest_area'::text, 'car_park'::text, 'park_and_ride'::text, 'truck'::text, 'other'::text])))
);

CREATE TABLE public.parking_facilities_bysa (
    id bigint NOT NULL,
    source_feed text NOT NULL,
    external_id text NOT NULL,
    kind text NOT NULL,
    name text,
    operator text,
    road text,
    capacity_total integer,
    capacity_truck integer,
    capacity_disabled integer,
    geom public.geography(Point,4326) NOT NULL,
    address jsonb,
    opening jsonb,
    attribution_id text NOT NULL,
    source_version text,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    closed_at timestamp with time zone,
    source_publisher text,
    source_run_id bigint,
    provider_updated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    confidentiality text,
    CONSTRAINT parking_facilities_bysa_capacity CHECK (((COALESCE(capacity_total, 0) >= 0) AND (COALESCE(capacity_truck, 0) >= 0) AND (COALESCE(capacity_disabled, 0) >= 0))),
    CONSTRAINT parking_facilities_bysa_kind CHECK ((kind = ANY (ARRAY['rest_area'::text, 'car_park'::text, 'park_and_ride'::text, 'truck'::text, 'other'::text]))),
    CONSTRAINT parking_facilities_bysa_licence CHECK ((attribution_id = 'mobilithek_park_nrw_pr'::text))
);

CREATE SEQUENCE public.parking_facilities_bysa_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.parking_facilities_bysa_id_seq OWNED BY public.parking_facilities_bysa.id;

CREATE VIEW public.parking_facilities_bysa_live AS
 SELECT id,
    source_feed,
    kind,
    name,
    operator,
    road,
    address,
    capacity_total,
    capacity_truck,
    capacity_disabled,
    attribution_id,
    geom,
    closed_at,
    confidentiality
   FROM public.parking_facilities_bysa f
  WHERE (closed_at IS NULL);

CREATE SEQUENCE public.parking_facilities_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.parking_facilities_id_seq OWNED BY public.parking_facilities.id;

CREATE VIEW public.parking_facilities_live AS
 SELECT id,
    source_feed,
    external_id,
    kind,
    name,
    operator,
    road,
    capacity_total,
    capacity_truck,
    capacity_disabled,
    geom,
    address,
    opening,
    attribution_id,
    source_version,
    first_seen_at,
    last_seen_at,
    closed_at,
    source_publisher,
    source_run_id,
    provider_updated_at,
    created_at,
    updated_at,
    deleted_at,
    deleted_reason,
    deleted_run_id,
    station_ref,
    station_name,
    station_name_norm,
    confidentiality,
    facilities,
    facilities_absent,
    facilities_extra,
    facilities_source
   FROM public.parking_facilities
  WHERE (deleted_at IS NULL);

CREATE TABLE public.parking_facilities_odbl (
    id bigint NOT NULL,
    source_feed text NOT NULL,
    external_id text NOT NULL,
    kind text NOT NULL,
    name text,
    operator text,
    road text,
    capacity_total integer,
    capacity_truck integer,
    capacity_disabled integer,
    geom public.geography(Point,4326) NOT NULL,
    address jsonb,
    opening jsonb,
    attribution_id text NOT NULL,
    source_version text,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    closed_at timestamp with time zone,
    source_publisher text,
    source_run_id bigint,
    provider_updated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    confidentiality text,
    CONSTRAINT parking_facilities_odbl_capacity CHECK (((COALESCE(capacity_total, 0) >= 0) AND (COALESCE(capacity_truck, 0) >= 0) AND (COALESCE(capacity_disabled, 0) >= 0))),
    CONSTRAINT parking_facilities_odbl_kind CHECK ((kind = ANY (ARRAY['rest_area'::text, 'car_park'::text, 'park_and_ride'::text, 'truck'::text, 'other'::text]))),
    CONSTRAINT parking_facilities_odbl_licence CHECK ((attribution_id = 'mobilithek_park_trucklounge'::text))
);

CREATE SEQUENCE public.parking_facilities_odbl_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.parking_facilities_odbl_id_seq OWNED BY public.parking_facilities_odbl.id;

CREATE VIEW public.parking_facilities_odbl_live AS
 SELECT id,
    source_feed,
    kind,
    name,
    operator,
    road,
    address,
    capacity_total,
    capacity_truck,
    capacity_disabled,
    attribution_id,
    geom,
    closed_at,
    confidentiality
   FROM public.parking_facilities_odbl f
  WHERE (closed_at IS NULL);

CREATE TABLE public.parking_facilities_sid (
    id bigint DEFAULT nextval('public.parking_facilities_id_seq'::regclass) NOT NULL,
    source_feed text NOT NULL,
    external_id text NOT NULL,
    kind text NOT NULL,
    name text,
    capacity_total integer,
    capacity_truck integer,
    geom public.geography(Point,4326) NOT NULL,
    address jsonb,
    attribution_id text NOT NULL,
    source_version text,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    closed_at timestamp with time zone,
    source_publisher text,
    source_run_id bigint,
    provider_updated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    confidentiality text,
    facilities text[] DEFAULT '{}'::text[] NOT NULL,
    facilities_absent text[] DEFAULT '{}'::text[] NOT NULL,
    facilities_extra text[] DEFAULT '{}'::text[] NOT NULL,
    facilities_source text,
    CONSTRAINT parking_facilities_sid_address CHECK (((address IS NULL) OR ((jsonb_typeof(address) = 'object'::text) AND ((address - ARRAY['street'::text, 'house_number'::text, 'postcode'::text, 'city'::text]) = '{}'::jsonb)))),
    CONSTRAINT parking_facilities_sid_capacity CHECK (((COALESCE(capacity_total, 0) >= 0) AND (COALESCE(capacity_truck, 0) >= 0))),
    CONSTRAINT parking_facilities_sid_facilities_absent_vocabulary CHECK ((facilities_absent <@ ARRAY['toilet'::text, 'accessible_toilet'::text, 'shower'::text, 'restaurant'::text, 'snack'::text, 'cafe'::text, 'shop'::text, 'fuel'::text, 'charging'::text, 'drinking_water'::text, 'picnic'::text, 'playground'::text, 'wifi'::text, 'security'::text])),
    CONSTRAINT parking_facilities_sid_facilities_disjoint CHECK ((NOT (facilities && facilities_absent))),
    CONSTRAINT parking_facilities_sid_facilities_source CHECK (((facilities_source IS NULL) = ((cardinality(facilities) = 0) AND (cardinality(facilities_absent) = 0)))),
    CONSTRAINT parking_facilities_sid_facilities_vocabulary CHECK ((facilities <@ ARRAY['toilet'::text, 'accessible_toilet'::text, 'shower'::text, 'restaurant'::text, 'snack'::text, 'cafe'::text, 'shop'::text, 'fuel'::text, 'charging'::text, 'drinking_water'::text, 'picnic'::text, 'playground'::text, 'wifi'::text, 'security'::text])),
    CONSTRAINT parking_facilities_sid_feed CHECK ((source_feed = 'truckpark_sid_static'::text)),
    CONSTRAINT parking_facilities_sid_kind CHECK ((kind = ANY (ARRAY['rest_area'::text, 'car_park'::text, 'park_and_ride'::text, 'truck'::text, 'other'::text]))),
    CONSTRAINT parking_facilities_sid_licence CHECK ((attribution_id = 'toll_collect_sid'::text))
);

CREATE VIEW public.parking_facilities_sid_live AS
 SELECT id,
    source_feed,
    external_id,
    kind,
    name,
    capacity_total,
    capacity_truck,
    geom,
    address,
    attribution_id,
    last_seen_at,
    closed_at,
    confidentiality
   FROM public.parking_facilities_sid s;

CREATE TABLE public.parking_facility_refusals (
    source_feed text NOT NULL,
    refusals jsonb NOT NULL,
    refused_at timestamp with time zone NOT NULL,
    CONSTRAINT parking_facility_refusals_is_array CHECK ((jsonb_typeof(refusals) = 'array'::text))
);

CREATE TABLE public.parking_forecast_profiles (
    id bigint NOT NULL,
    facility_id bigint NOT NULL,
    facility_name text NOT NULL,
    day_type text NOT NULL,
    band_start smallint NOT NULL,
    band_end smallint NOT NULL,
    class text NOT NULL,
    class_raw text NOT NULL,
    valid_from date NOT NULL,
    source_version text NOT NULL,
    attribution_id text NOT NULL,
    raw jsonb NOT NULL,
    first_seen_at timestamp with time zone NOT NULL,
    last_seen_at timestamp with time zone NOT NULL,
    superseded_at timestamp with time zone,
    source_feed text NOT NULL,
    source_publisher text,
    source_run_id bigint,
    provider_updated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    deleted_reason text,
    deleted_run_id bigint,
    CONSTRAINT parking_forecast_profiles_attribution CHECK (((attribution_id <> ''::text) AND (attribution_id !~~ '%\_pending'::text))),
    CONSTRAINT parking_forecast_profiles_band CHECK ((((band_start >= 0) AND (band_start <= 23)) AND ((band_end >= 0) AND (band_end <= 24)) AND (band_start <> band_end))),
    CONSTRAINT parking_forecast_profiles_class CHECK ((class = ANY (ARRAY['green'::text, 'yellow'::text, 'red'::text]))),
    CONSTRAINT parking_forecast_profiles_day_type CHECK ((day_type = ANY (ARRAY['weekday'::text, 'saturday'::text, 'sunday'::text])))
);

ALTER TABLE public.parking_forecast_profiles ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.parking_forecast_profiles_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE VIEW public.parking_forecast_profiles_live AS
 SELECT id,
    facility_id,
    facility_name,
    day_type,
    band_start,
    band_end,
    class,
    class_raw,
    valid_from,
    source_version,
    attribution_id,
    raw,
    first_seen_at,
    last_seen_at,
    superseded_at,
    source_feed,
    source_publisher,
    source_run_id,
    provider_updated_at,
    created_at,
    updated_at,
    deleted_at,
    deleted_reason,
    deleted_run_id
   FROM public.parking_forecast_profiles
  WHERE (deleted_at IS NULL);

CREATE TABLE public.parking_occupancy (
    observed_at timestamp with time zone NOT NULL,
    facility_id bigint NOT NULL,
    spaces_free integer,
    spaces_total integer,
    occupancy_pct numeric(5,2),
    status text,
    feed_ts timestamp with time zone,
    source_feed text NOT NULL,
    source_run_id bigint,
    raw jsonb NOT NULL,
    confidentiality text,
    implausible_fields text[],
    CONSTRAINT parking_occupancy_counts CHECK (((COALESCE(spaces_free, 0) >= 0) AND (COALESCE(spaces_total, 0) >= 0)))
)
PARTITION BY RANGE (observed_at);

CREATE VIEW public.parking_occupancy_live AS
 SELECT facility_id,
    observed_at,
    feed_ts,
    spaces_free,
    spaces_total,
    occupancy_pct,
    status,
    source_feed,
    confidentiality,
    implausible_fields
   FROM public.parking_occupancy p;

CREATE TABLE public.parking_occupancy_odbl (
    observed_at timestamp with time zone NOT NULL,
    facility_id bigint NOT NULL,
    spaces_free integer,
    spaces_total integer,
    occupancy_pct numeric(5,2),
    status text,
    feed_ts timestamp with time zone,
    source_feed text NOT NULL,
    source_run_id bigint,
    attribution_id text NOT NULL,
    raw jsonb NOT NULL,
    confidentiality text,
    implausible_fields text[],
    CONSTRAINT parking_occupancy_odbl_counts CHECK (((COALESCE(spaces_free, 0) >= 0) AND (COALESCE(spaces_total, 0) >= 0))),
    CONSTRAINT parking_occupancy_odbl_licence CHECK ((attribution_id = 'mobilithek_park_trucklounge_occ'::text))
);

CREATE VIEW public.parking_occupancy_odbl_live AS
 SELECT facility_id,
    observed_at,
    feed_ts,
    spaces_free,
    spaces_total,
    occupancy_pct,
    status,
    source_feed,
    attribution_id,
    confidentiality,
    implausible_fields
   FROM public.parking_occupancy_odbl p;

CREATE TABLE public.parking_occupancy_sid (
    observed_at timestamp with time zone NOT NULL,
    facility_id bigint NOT NULL,
    spaces_free integer,
    spaces_total integer,
    occupancy_pct numeric(5,2),
    status text,
    feed_ts timestamp with time zone,
    source_feed text NOT NULL,
    source_run_id bigint,
    raw jsonb NOT NULL,
    confidentiality text,
    implausible_fields text[],
    CONSTRAINT parking_occupancy_sid_counts CHECK (((COALESCE(spaces_free, 0) >= 0) AND (COALESCE(spaces_total, 0) >= 0))),
    CONSTRAINT parking_occupancy_sid_feed CHECK ((source_feed = 'truckpark_sid_dyn'::text))
)
PARTITION BY RANGE (observed_at);

CREATE VIEW public.parking_occupancy_sid_live AS
 SELECT facility_id,
    observed_at,
    feed_ts,
    spaces_free,
    spaces_total,
    occupancy_pct,
    status,
    source_feed,
    confidentiality,
    implausible_fields
   FROM public.parking_occupancy_sid p;

CREATE TABLE public.parking_sites (
    site_id text NOT NULL,
    source_version text,
    name text,
    capacity integer,
    geom public.geography(Point,4326) NOT NULL,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    closed_at timestamp with time zone,
    source_feed text,
    source_publisher text,
    source_run_id bigint,
    provider_updated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    deleted_reason text,
    deleted_run_id bigint
);

CREATE VIEW public.parking_sites_live AS
 SELECT site_id,
    source_version,
    name,
    capacity,
    geom,
    first_seen_at,
    last_seen_at,
    closed_at,
    source_feed,
    source_publisher,
    source_run_id,
    provider_updated_at,
    created_at,
    updated_at,
    deleted_at,
    deleted_reason,
    deleted_run_id
   FROM public.parking_sites
  WHERE (deleted_at IS NULL);

CREATE TABLE public.partition_archives (
    id bigint NOT NULL,
    table_name text NOT NULL,
    day date NOT NULL,
    path text NOT NULL,
    bytes bigint NOT NULL,
    rows bigint NOT NULL,
    sha256 text NOT NULL,
    dumped_at timestamp with time zone DEFAULT now() NOT NULL,
    dropped_at timestamp with time zone,
    restored_at timestamp with time zone,
    source_run_id bigint,
    CONSTRAINT partition_archives_bytes_check CHECK ((bytes > 0)),
    CONSTRAINT partition_archives_rows_check CHECK ((rows >= 0)),
    CONSTRAINT partition_archives_sha256_check CHECK ((sha256 ~ '^[0-9a-f]{64}$'::text))
);

CREATE SEQUENCE public.partition_archives_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.partition_archives_id_seq OWNED BY public.partition_archives.id;

CREATE TABLE public.partition_settings (
    singleton boolean DEFAULT true NOT NULL,
    min_daily_tables integer NOT NULL,
    CONSTRAINT partition_settings_floor_positive CHECK ((min_daily_tables >= 1)),
    CONSTRAINT partition_settings_one_row CHECK (singleton)
);

CREATE TABLE public.place_slugs (
    ags text NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    assigned_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT place_slugs_ags_check CHECK ((ags ~ '^[0-9]{8}$'::text)),
    CONSTRAINT place_slugs_slug_check CHECK (((slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text) AND (length(slug) <= 80) AND (slug !~ '[0-9]{5}'::text)))
);

CREATE TABLE public.place_website_checks (
    url text NOT NULL,
    ok boolean NOT NULL,
    reason text,
    checked_at timestamp with time zone NOT NULL,
    CONSTRAINT place_website_checks_check CHECK (((ok AND (reason IS NULL)) OR ((NOT ok) AND (reason IS NOT NULL) AND (length(reason) <= 300)))),
    CONSTRAINT place_website_checks_url_check CHECK (((url ~ '^https://[^[:space:]"<>''`]+$'::text) AND (length(url) <= 300)))
);

CREATE TABLE public.place_websites (
    ags text NOT NULL,
    url text NOT NULL,
    source_id text NOT NULL,
    wikidata_id text NOT NULL,
    retrieved_at timestamp with time zone NOT NULL,
    checked_at timestamp with time zone NOT NULL,
    CONSTRAINT place_websites_ags_check CHECK ((ags ~ '^[0-9]{8}$'::text)),
    CONSTRAINT place_websites_source_id_check CHECK ((source_id = 'wikidata'::text)),
    CONSTRAINT place_websites_url_check CHECK (((url ~ '^https://[^[:space:]"<>''`]+$'::text) AND (length(url) <= 300))),
    CONSTRAINT place_websites_wikidata_id_check CHECK ((wikidata_id ~ '^Q[0-9]{1,12}$'::text))
);

CREATE TABLE public.provider_key_claims (
    provider text NOT NULL,
    last_request_at timestamp with time zone DEFAULT '1970-01-01 00:00:00+00'::timestamp with time zone NOT NULL,
    claimed_by text,
    person_wanted_at timestamp with time zone
);

CREATE VIEW public.registered_sources AS
 SELECT s.id AS source_id,
    s.name AS display_name,
    s.domain,
    s.publisher,
    s.provider,
    COALESCE(c.licence_label, s.licence_id) AS licence_label,
    s.licence_url,
    s.attribution,
    NULL::text AS dataset_url,
    c.cadence_s,
    (s.status = 'enabled'::text) AS enabled
   FROM (ingestor.sources s
     LEFT JOIN public.feed_catalog c ON (((c.feed_key = s.id) AND (c.published_by = 'ingestor'::text))));

CREATE TABLE public.road_context_feature_versions (
    source_feed text NOT NULL,
    feature_id text NOT NULL,
    content_hash text NOT NULL,
    observed_at timestamp with time zone NOT NULL,
    props jsonb NOT NULL,
    geom public.geometry(Geometry,4326) NOT NULL,
    source_run_id bigint
);

CREATE TABLE public.road_context_features (
    source_feed text NOT NULL,
    source_publisher text NOT NULL,
    feature_id text NOT NULL,
    kind text NOT NULL,
    variant text NOT NULL,
    name text NOT NULL,
    ref text,
    detail_text text,
    answerable boolean DEFAULT true NOT NULL,
    props jsonb NOT NULL,
    geom public.geometry(Geometry,4326) NOT NULL,
    anchor public.geometry(Point,4326) NOT NULL,
    content_hash text NOT NULL,
    first_seen_at timestamp with time zone NOT NULL,
    last_seen_at timestamp with time zone NOT NULL,
    closed_at timestamp with time zone,
    source_run_id bigint,
    provider_updated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT road_context_kind_known CHECK ((kind = ANY (ARRAY['border_crossing'::text, 'traffic_signal'::text, 'winter_service'::text, 'pedestrian_zone_access'::text, 'detour'::text, 'loading_zone'::text, 'coach_parking'::text, 'motorway_detour'::text, 'street_parking'::text, 'signal_installation'::text]))),
    CONSTRAINT road_context_variant_known CHECK ((((kind = 'border_crossing'::text) AND (variant = ANY (ARRAY['motorway'::text, 'federal'::text, 'state'::text, 'district'::text, 'ferry'::text, 'other'::text]))) OR ((kind = 'traffic_signal'::text) AND (variant = ANY (ARRAY['acoustic'::text, 'plain'::text]))) OR ((kind = 'winter_service'::text) AND (variant = ANY (ARRAY['priority_1'::text, 'priority_2'::text, 'priority_3'::text, 'unranked'::text]))) OR ((kind = 'pedestrian_zone_access'::text) AND (variant = ANY (ARRAY['pedestrian_zone'::text, 'no_motor_vehicles'::text, 'no_entry'::text, 'no_cycling'::text, 'sign_not_listed'::text]))) OR ((kind = 'detour'::text) AND (variant = ANY (ARRAY['motor_vehicles'::text, 'lorries'::text, 'cars'::text, 'cycles'::text, 'all_traffic'::text, 'other'::text]))) OR ((kind = 'loading_zone'::text) AND (variant = ANY (ARRAY['load_deliver'::text, 'load_deliver_work'::text, 'alternating'::text, 'other'::text]))) OR ((kind = 'coach_parking'::text) AND (variant = ANY (ARRAY['parking'::text, 'stop_only'::text]))) OR ((kind = 'motorway_detour'::text) AND (variant = 'signed'::text)) OR ((kind = 'street_parking'::text) AND (variant = ANY (ARRAY['ticket'::text, 'disc'::text, 'unmanaged'::text, 'disabled'::text, 'ev_charging'::text, 'loading'::text, 'sharing'::text, 'disabled_personal'::text, 'restricted_stopping'::text, 'no_stopping'::text, 'unresolved'::text, 'other'::text]))) OR ((kind = 'signal_installation'::text) AND (variant = ANY (ARRAY['junction'::text, 'pedestrian_crossing'::text, 'other'::text])))))
);

CREATE VIEW public.road_context_live AS
 SELECT source_feed,
    feature_id,
    kind,
    variant,
    name,
    ref,
    detail_text,
    props,
    geom,
    anchor,
    last_seen_at
   FROM public.road_context_features
  WHERE ((closed_at IS NULL) AND answerable);

CREATE TABLE public.road_event_locations (
    road_event_id bigint NOT NULL,
    seq integer NOT NULL,
    road_number text,
    referent_from text,
    referent_to text,
    distance_from_m integer,
    distance_to_m integer,
    geom public.geometry(Geometry,4326),
    source_feed text,
    source_publisher text,
    source_run_id bigint,
    provider_updated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    deleted_reason text,
    deleted_run_id bigint
);

CREATE TABLE public.road_events (
    id bigint NOT NULL,
    feed_key text NOT NULL,
    source_id text NOT NULL,
    publication_id text NOT NULL,
    version integer NOT NULL,
    publisher text,
    event_type text,
    road_number text,
    referent_from text,
    referent_to text,
    distance_from_m integer,
    distance_to_m integer,
    geom public.geometry(Geometry,4326),
    feed_ts timestamp with time zone,
    overall_start timestamp with time zone,
    overall_end timestamp with time zone,
    payload jsonb NOT NULL,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    closed_at timestamp with time zone,
    source_feed text,
    source_publisher text,
    source_run_id bigint,
    provider_updated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    deleted_reason text,
    deleted_run_id bigint,
    confidentiality text,
    closure_starts_at timestamp with time zone,
    closure_ends_at timestamp with time zone,
    valid_windows tstzmultirange,
    suspended boolean
);

CREATE VIEW public.road_event_locations_live AS
 SELECT road_event_id,
    seq,
    road_number,
    referent_from,
    referent_to,
    distance_from_m,
    distance_to_m,
    geom,
    source_feed,
    source_publisher,
    source_run_id,
    provider_updated_at,
    created_at,
    updated_at,
    deleted_at,
    deleted_reason,
    deleted_run_id
   FROM public.road_event_locations l
  WHERE ((deleted_at IS NULL) AND (EXISTS ( SELECT 1
           FROM public.road_events e
          WHERE ((e.id = l.road_event_id) AND (e.deleted_at IS NULL)))));

CREATE TABLE public.road_event_record_types (
    feed_key text NOT NULL,
    record_type text NOT NULL,
    known boolean NOT NULL,
    first_seen_at timestamp with time zone NOT NULL,
    last_seen_at timestamp with time zone NOT NULL,
    seen_count bigint NOT NULL
);

CREATE TABLE public.road_event_ticks (
    observed_at timestamp with time zone NOT NULL,
    feed_ts timestamp with time zone,
    feed_key text NOT NULL,
    source_id text NOT NULL,
    publication_id text NOT NULL,
    version integer NOT NULL,
    payload jsonb NOT NULL,
    source_run_id bigint
)
PARTITION BY RANGE (observed_at);

CREATE TABLE public.road_event_twins (
    twin_id bigint NOT NULL,
    origin_id bigint NOT NULL,
    rule text NOT NULL,
    score smallint NOT NULL,
    linked_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT road_event_twins_not_self CHECK ((twin_id <> origin_id)),
    CONSTRAINT road_event_twins_rule_known CHECK ((rule = 'asb_node'::text)),
    CONSTRAINT road_event_twins_score_range CHECK (((score >= 1) AND (score <= 3)))
);

CREATE VIEW public.road_events_live AS
 SELECT id,
    feed_key,
    source_id,
    publication_id,
    version,
    publisher,
    event_type,
    road_number,
    referent_from,
    referent_to,
    distance_from_m,
    distance_to_m,
    geom,
    feed_ts,
    overall_start,
    overall_end,
    payload,
    first_seen_at,
    last_seen_at,
    closed_at,
    source_feed,
    source_publisher,
    source_run_id,
    provider_updated_at,
    created_at,
    updated_at,
    deleted_at,
    deleted_reason,
    deleted_run_id,
    confidentiality,
    closure_starts_at,
    closure_ends_at,
    valid_windows,
    suspended
   FROM public.road_events
  WHERE (deleted_at IS NULL);

CREATE VIEW public.road_events_current AS
 SELECT id,
    feed_key,
    source_id,
    publication_id,
    version,
    publisher,
    event_type,
    road_number,
    referent_from,
    referent_to,
    distance_from_m,
    distance_to_m,
    geom,
    feed_ts,
    overall_start,
    overall_end,
    payload,
    first_seen_at,
    last_seen_at,
    closed_at,
    source_feed,
    source_publisher,
    source_run_id,
    provider_updated_at,
    created_at,
    updated_at,
    deleted_at,
    deleted_reason,
    deleted_run_id,
    confidentiality,
    closure_starts_at,
    closure_ends_at,
    valid_windows,
    suspended
   FROM public.road_events_live e
  WHERE ((closed_at IS NULL) AND public.road_event_in_force_known(overall_start, overall_end, suspended, payload, valid_windows, now()) AND (COALESCE(confidentiality, 'noRestriction'::text) = 'noRestriction'::text));

ALTER TABLE public.road_events ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.road_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.road_weather_forecast (
    station_id text NOT NULL,
    valid_at timestamp with time zone NOT NULL,
    run_at timestamp with time zone NOT NULL,
    source_id text NOT NULL,
    source_run_id bigint NOT NULL,
    tl real,
    tlsta real,
    rrl1c real,
    rrs1c real,
    rr6 real,
    wwl6 real,
    wws3 real,
    rrs3c real,
    r650 real,
    rc smallint,
    ts real,
    td real,
    CONSTRAINT road_weather_forecast_rc CHECK (((rc IS NULL) OR ((rc >= 1) AND (rc <= 6)))),
    CONSTRAINT road_weather_forecast_source CHECK ((source_id = 'dwd_road'::text))
);

CREATE VIEW public.road_weather_forecast_live AS
 SELECT station_id,
    valid_at,
    run_at,
    rc,
    ts,
    tl,
    rrl1c,
    rrs1c
   FROM public.road_weather_forecast f;

CREATE TABLE public.road_weather_stations (
    station_id text NOT NULL,
    source_id text NOT NULL,
    name text NOT NULL,
    segment_type smallint,
    surface smallint,
    geom public.geography(Point,4326) NOT NULL,
    position_source text NOT NULL,
    height_m integer,
    flag_raw text,
    inactive boolean DEFAULT false NOT NULL,
    inactive_raw text,
    raw jsonb NOT NULL,
    source_feed text NOT NULL,
    source_publisher text,
    source_run_id bigint,
    provider_updated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    closed_at timestamp with time zone,
    CONSTRAINT road_weather_stations_position_source CHECK ((position_source = 'swsKatalog'::text)),
    CONSTRAINT road_weather_stations_segment CHECK (((segment_type IS NULL) OR (segment_type = ANY (ARRAY[1, 2])))),
    CONSTRAINT road_weather_stations_source CHECK ((source_id = 'dwd_road'::text)),
    CONSTRAINT road_weather_stations_surface CHECK (((surface IS NULL) OR (surface = ANY (ARRAY[1, 2]))))
);

CREATE VIEW public.road_weather_stations_live AS
 SELECT station_id,
    name,
    segment_type,
    position_source,
    geom
   FROM public.road_weather_stations s
  WHERE ((closed_at IS NULL) AND (NOT inactive));

CREATE TABLE public.routes (
    deleted_at timestamp with time zone,
    deleted_run_id bigint,
    route_type integer NOT NULL,
    gtfs_feed_key smallint NOT NULL,
    id text NOT NULL,
    agency_id text,
    short_name text,
    long_name text,
    deleted_reason text,
    extras jsonb DEFAULT '{}'::jsonb NOT NULL
);

CREATE VIEW public.routes_live AS
 SELECT deleted_at,
    deleted_run_id,
    route_type,
    gtfs_feed_key,
    id,
    agency_id,
    short_name,
    long_name,
    deleted_reason,
    extras
   FROM public.routes
  WHERE (deleted_at IS NULL);

CREATE TABLE public.search_console_weekly (
    week date NOT NULL,
    state text NOT NULL,
    read_at timestamp with time zone DEFAULT now() NOT NULL,
    tried_at timestamp with time zone DEFAULT now() NOT NULL,
    impressions bigint,
    clicks bigint,
    "position" numeric(6,2),
    shown_not_clicked integer,
    legacy_impressions bigint,
    CONSTRAINT search_console_weekly_check CHECK (((state = 'read'::text) = ((impressions IS NOT NULL) AND (clicks IS NOT NULL)))),
    CONSTRAINT search_console_weekly_check1 CHECK (((state = 'read'::text) OR (("position" IS NULL) AND (shown_not_clicked IS NULL) AND (legacy_impressions IS NULL)))),
    CONSTRAINT search_console_weekly_check2 CHECK (((clicks IS NULL) OR (impressions IS NULL) OR (clicks <= impressions))),
    CONSTRAINT search_console_weekly_clicks_check CHECK ((clicks >= 0)),
    CONSTRAINT search_console_weekly_impressions_check CHECK ((impressions >= 0)),
    CONSTRAINT search_console_weekly_legacy_impressions_check CHECK ((legacy_impressions >= 0)),
    CONSTRAINT search_console_weekly_position_check CHECK (("position" >= (0)::numeric)),
    CONSTRAINT search_console_weekly_shown_not_clicked_check CHECK ((shown_not_clicked >= 0)),
    CONSTRAINT search_console_weekly_state_check CHECK ((state = ANY (ARRAY['read'::text, 'unread'::text]))),
    CONSTRAINT search_console_weekly_week_check CHECK ((EXTRACT(isodow FROM week) = (1)::numeric))
);

CREATE TABLE public.search_console_weekly_parts (
    week date NOT NULL,
    dimension text NOT NULL,
    key text NOT NULL,
    rows integer,
    impressions bigint NOT NULL,
    clicks bigint NOT NULL,
    "position" numeric(6,2),
    CONSTRAINT search_console_weekly_parts_check CHECK (((clicks >= 0) AND (clicks <= impressions))),
    CONSTRAINT search_console_weekly_parts_check1 CHECK ((((dimension = 'device'::text) AND (key = ANY (ARRAY['mobile'::text, 'desktop'::text, 'tablet'::text]))) OR ((dimension = 'page_type'::text) AND (key = ANY (ARRAY['road'::text, 'exit'::text, 'place'::text, 'station'::text, 'home'::text, 'other'::text]))) OR ((dimension = 'position_bucket'::text) AND (key = ANY (ARRAY['1-3'::text, '4-10'::text, '11-20'::text, '21-50'::text, '51+'::text]))))),
    CONSTRAINT search_console_weekly_parts_check2 CHECK (((dimension = 'position_bucket'::text) = (rows IS NOT NULL))),
    CONSTRAINT search_console_weekly_parts_dimension_check CHECK ((dimension = ANY (ARRAY['device'::text, 'page_type'::text, 'position_bucket'::text]))),
    CONSTRAINT search_console_weekly_parts_impressions_check CHECK ((impressions >= 0)),
    CONSTRAINT search_console_weekly_parts_position_check CHECK (("position" >= (0)::numeric)),
    CONSTRAINT search_console_weekly_parts_rows_check CHECK ((rows >= 0))
);

CREATE VIEW public.service_alert_lands_live AS
 SELECT l.land,
    max(a.last_seen_at) AS last_seen_at,
    (count(*))::integer AS alerts
   FROM (public.delfi_service_alerts a
     CROSS JOIN LATERAL unnest(a.lands) l(land))
  WHERE ((a.placed_by = ANY (ARRAY['stop'::text, 'route'::text])) AND (COALESCE(a.confidentiality, 'noRestriction'::text) = 'noRestriction'::text))
  GROUP BY l.land;

CREATE TABLE public.site_visits_daily (
    day date NOT NULL,
    visitors integer NOT NULL,
    page_views integer NOT NULL,
    complete boolean NOT NULL,
    computed_at timestamp with time zone DEFAULT now() NOT NULL,
    visits integer,
    automated integer,
    own_views integer,
    crawler_views integer,
    rule smallint,
    CONSTRAINT site_visits_daily_automated_check CHECK ((automated >= 0)),
    CONSTRAINT site_visits_daily_check CHECK ((visitors <= page_views)),
    CONSTRAINT site_visits_daily_crawler_range CHECK (((crawler_views IS NULL) OR (automated IS NULL) OR (crawler_views <= automated))),
    CONSTRAINT site_visits_daily_crawler_views_check CHECK ((crawler_views >= 0)),
    CONSTRAINT site_visits_daily_own_range CHECK (((own_views IS NULL) OR (own_views <= page_views))),
    CONSTRAINT site_visits_daily_own_views_check CHECK ((own_views >= 0)),
    CONSTRAINT site_visits_daily_page_views_check CHECK ((page_views >= 0)),
    CONSTRAINT site_visits_daily_rule_known CHECK (((rule IS NULL) OR ((rule >= 1) AND (rule <= 100)))),
    CONSTRAINT site_visits_daily_visitors_check CHECK ((visitors >= 0)),
    CONSTRAINT site_visits_daily_visits_check CHECK ((visits >= 0)),
    CONSTRAINT site_visits_daily_visits_range CHECK (((visits IS NULL) OR ((visits >= visitors) AND (visits <= page_views))))
);

CREATE TABLE public.site_visits_devices (
    day date NOT NULL,
    device text NOT NULL,
    views integer NOT NULL,
    CONSTRAINT site_visits_devices_device_check CHECK ((device = ANY (ARRAY['desktop'::text, 'mobile'::text, 'tablet'::text, 'other'::text]))),
    CONSTRAINT site_visits_devices_views_check CHECK ((views > 0))
);

CREATE TABLE public.site_visits_entries (
    day date NOT NULL,
    route text NOT NULL,
    visits integer NOT NULL,
    CONSTRAINT site_visits_entries_route_check CHECK (((route = 'other'::text) OR (route ~ '^/[a-z0-9/-]{0,60}$'::text))),
    CONSTRAINT site_visits_entries_visits_check CHECK ((visits > 0))
);

CREATE TABLE public.site_visits_entry_referrers (
    day date NOT NULL,
    referrer text NOT NULL,
    visits integer NOT NULL,
    CONSTRAINT site_visits_entry_referrers_check CHECK (((visits >= 3) OR (referrer = ANY (ARRAY['direct'::text, 'app'::text, 'other'::text])))),
    CONSTRAINT site_visits_entry_referrers_referrer_check CHECK ((referrer ~ '^[a-z0-9.-]{1,253}$'::text)),
    CONSTRAINT site_visits_entry_referrers_visits_check CHECK ((visits > 0))
);

CREATE TABLE public.site_visits_hourly (
    day date NOT NULL,
    hour smallint NOT NULL,
    visits integer NOT NULL,
    page_views integer NOT NULL,
    CONSTRAINT site_visits_hourly_check CHECK ((visits <= page_views)),
    CONSTRAINT site_visits_hourly_hour_check CHECK (((hour >= 0) AND (hour <= 23))),
    CONSTRAINT site_visits_hourly_page_views_check CHECK ((page_views >= 0)),
    CONSTRAINT site_visits_hourly_visits_check CHECK ((visits >= 0))
);

CREATE TABLE public.site_visits_pages_per_visit (
    day date NOT NULL,
    bucket text NOT NULL,
    visits integer NOT NULL,
    CONSTRAINT site_visits_pages_per_visit_bucket_check CHECK ((bucket = ANY (ARRAY['1'::text, '2'::text, '3'::text, '4-5'::text, '6-10'::text, '11+'::text]))),
    CONSTRAINT site_visits_pages_per_visit_visits_check CHECK ((visits > 0))
);

CREATE TABLE public.site_visits_referrers (
    day date NOT NULL,
    referrer text NOT NULL,
    views integer NOT NULL,
    CONSTRAINT site_visits_referrers_referrer_check CHECK ((referrer ~ '^[a-z0-9.-]{1,253}$'::text)),
    CONSTRAINT site_visits_referrers_views_check CHECK ((views > 0))
);

CREATE TABLE public.site_visits_routes (
    day date NOT NULL,
    route text NOT NULL,
    lang text NOT NULL,
    views integer NOT NULL,
    CONSTRAINT site_visits_routes_lang_check CHECK ((lang = ANY (ARRAY['de'::text, 'en'::text, 'ru'::text, 'bg'::text, 'uk'::text, 'ro'::text, 'tr'::text, 'fr'::text, 'es'::text, 'nl'::text, 'pl'::text, 'it'::text, 'lt'::text, 'cs'::text, 'hu'::text, 'sk'::text, 'da'::text, 'pt'::text, 'hr'::text, 'sr'::text, 'el'::text, 'lv'::text, 'auto'::text, 'other'::text]))),
    CONSTRAINT site_visits_routes_route_check CHECK (((route = 'other'::text) OR (route ~ '^/[a-z0-9/-]{0,60}$'::text))),
    CONSTRAINT site_visits_routes_views_check CHECK ((views > 0))
);

CREATE TABLE public.site_visits_search_engines (
    day date NOT NULL,
    engine text NOT NULL,
    visits integer NOT NULL,
    CONSTRAINT site_visits_search_engines_engine_check CHECK ((engine = ANY (ARRAY['google'::text, 'bing'::text, 'duckduckgo'::text, 'ecosia'::text, 'qwant'::text, 'startpage'::text, 'yahoo'::text, 'yandex'::text, 'baidu'::text, 'other'::text]))),
    CONSTRAINT site_visits_search_engines_visits_check CHECK ((visits > 0))
);

CREATE TABLE public.source_hosts (
    host text NOT NULL,
    started_at timestamp with time zone NOT NULL,
    heartbeat_at timestamp with time zone NOT NULL,
    app_version text,
    sources integer NOT NULL,
    CONSTRAINT source_hosts_app_version_check CHECK (((app_version IS NULL) OR (length(app_version) <= 40))),
    CONSTRAINT source_hosts_host_check CHECK ((host = ANY (ARRAY['ingest-autobahn'::text, 'ingest-tankerkoenig'::text, 'ingest-mobilithek'::text, 'ingest-dwd'::text, 'ingest-vbb-rt'::text, 'ingest-db-fasta'::text, 'ingest-gtfs-roll'::text, 'ingest-gtfs-fetch'::text, 'ingest-zhv'::text, 'ingest-bnetza'::text, 'ingest-ocpdb'::text, 'ingest-hamburg'::text, 'ingest-gbfs'::text, 'retention'::text]))),
    CONSTRAINT source_hosts_order CHECK ((heartbeat_at >= started_at)),
    CONSTRAINT source_hosts_sources_check CHECK ((sources >= 0))
);

CREATE TABLE public.speed_enforcement (
    id bigint NOT NULL,
    source_feed text NOT NULL,
    source_publisher text NOT NULL,
    external_id text NOT NULL,
    attribution_id text NOT NULL,
    kind text NOT NULL,
    enforces text DEFAULT 'speed'::text NOT NULL,
    geom public.geography(Point,4326),
    ags text,
    municipality text,
    street text,
    location_text text,
    direction text,
    max_speed_kmh smallint,
    max_speed_hgv_kmh smallint,
    valid_from date,
    valid_to date,
    data_as_of date,
    provider_updated_at timestamp with time zone,
    extras jsonb DEFAULT '{}'::jsonb NOT NULL,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    closed_at timestamp with time zone,
    source_run_id bigint,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT speed_enforcement_ags CHECK (((ags IS NULL) OR (ags ~ '^[0-9]{8}$'::text))),
    CONSTRAINT speed_enforcement_announced CHECK (((kind <> 'mobile_announced'::text) OR (valid_from IS NOT NULL))),
    CONSTRAINT speed_enforcement_attribution CHECK ((attribution_id <> ''::text)),
    CONSTRAINT speed_enforcement_dated CHECK (((valid_to IS NULL) OR (valid_from IS NULL) OR (valid_to >= valid_from))),
    CONSTRAINT speed_enforcement_enforces CHECK ((enforces = ANY (ARRAY['speed'::text, 'red_light'::text, 'speed_red_light'::text]))),
    CONSTRAINT speed_enforcement_kind CHECK ((kind = ANY (ARRAY['fixed'::text, 'section_control'::text, 'mobile_announced'::text, 'measuring_site'::text]))),
    CONSTRAINT speed_enforcement_placed CHECK (((geom IS NOT NULL) OR (ags ~ '^[0-9]{8}$'::text))),
    CONSTRAINT speed_enforcement_publisher CHECK ((source_publisher <> ''::text)),
    CONSTRAINT speed_enforcement_speed CHECK (((max_speed_kmh IS NULL) OR ((max_speed_kmh >= 5) AND (max_speed_kmh <= 200)))),
    CONSTRAINT speed_enforcement_speed_hgv CHECK (((max_speed_hgv_kmh IS NULL) OR ((max_speed_hgv_kmh >= 5) AND (max_speed_hgv_kmh <= 200))))
);

CREATE SEQUENCE public.speed_enforcement_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.speed_enforcement_id_seq OWNED BY public.speed_enforcement.id;

CREATE VIEW public.speed_enforcement_live AS
 SELECT id,
    source_feed,
    source_publisher,
    external_id,
    attribution_id,
    kind,
    enforces,
    geom,
    ags,
    municipality,
    street,
    location_text,
    direction,
    max_speed_kmh,
    max_speed_hgv_kmh,
    valid_from,
    valid_to,
    data_as_of,
    provider_updated_at,
    extras,
    first_seen_at,
    last_seen_at,
    closed_at,
    source_run_id,
    created_at,
    updated_at
   FROM public.speed_enforcement
  WHERE (closed_at IS NULL);

CREATE TABLE public.station_accessibility (
    element_id text NOT NULL,
    element_kind text NOT NULL,
    stop_place_id text NOT NULL,
    eva_no text,
    eva_nos text[] DEFAULT '{}'::text[] NOT NULL,
    station_name text,
    quay_type text,
    quay_name text,
    plate_code text,
    parent_quay_id text,
    platform_height_raw text,
    platform_height_cm smallint,
    has_assessment boolean NOT NULL,
    mobility_impaired_access text,
    step_free_access text,
    wheelchair_access text,
    lift_free_access text,
    escalator_free_access text,
    stair_free_access text,
    ramp_free_access text,
    tactile_guidance text,
    audible_signals text,
    visual_signs text,
    guide_dog_access text,
    level_access_into_vehicle text,
    extras jsonb DEFAULT '{}'::jsonb NOT NULL,
    first_seen_at timestamp with time zone NOT NULL,
    last_seen_at timestamp with time zone NOT NULL,
    closed_at timestamp with time zone,
    source_feed text NOT NULL,
    source_publisher text NOT NULL,
    source_run_id bigint,
    provider_updated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT station_accessibility_eva_digits CHECK (((eva_no IS NULL) OR (eva_no ~ '^[0-9]{6,8}$'::text))),
    CONSTRAINT station_accessibility_height_credible CHECK (((platform_height_cm IS NULL) OR ((platform_height_cm >= 1) AND (platform_height_cm <= 200)))),
    CONSTRAINT station_accessibility_kind_known CHECK ((element_kind = ANY (ARRAY['stop_place'::text, 'quay'::text]))),
    CONSTRAINT station_accessibility_quay_fields CHECK (((element_kind = 'quay'::text) OR ((quay_type IS NULL) AND (plate_code IS NULL) AND (parent_quay_id IS NULL) AND (platform_height_raw IS NULL)))),
    CONSTRAINT station_accessibility_source_registered CHECK ((source_feed = 'openstation_netex'::text))
);

CREATE VIEW public.station_accessibility_live AS
 SELECT element_id,
    element_kind,
    stop_place_id,
    eva_no,
    eva_nos,
    station_name,
    quay_type,
    quay_name,
    plate_code,
    parent_quay_id,
    platform_height_cm,
    has_assessment,
    mobility_impaired_access,
    step_free_access,
    wheelchair_access,
    lift_free_access,
    escalator_free_access,
    stair_free_access,
    ramp_free_access,
    tactile_guidance,
    audible_signals,
    visual_signs,
    guide_dog_access,
    level_access_into_vehicle,
    provider_updated_at,
    source_feed
   FROM public.station_accessibility
  WHERE (closed_at IS NULL);

CREATE TABLE public.station_equipment (
    equipment_id text NOT NULL,
    kind text NOT NULL,
    equipment_no text,
    stop_place_id text,
    eva_no text,
    station_name text,
    description text,
    info_url text,
    wheelchair_passable boolean,
    extras jsonb DEFAULT '{}'::jsonb NOT NULL,
    first_seen_at timestamp with time zone NOT NULL,
    last_seen_at timestamp with time zone NOT NULL,
    closed_at timestamp with time zone,
    source_feed text NOT NULL,
    source_publisher text NOT NULL,
    source_run_id bigint,
    provider_updated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT station_equipment_eva_digits CHECK (((eva_no IS NULL) OR (eva_no ~ '^[0-9]{6,8}$'::text))),
    CONSTRAINT station_equipment_kind_known CHECK ((kind = ANY (ARRAY['elevator'::text, 'escalator'::text, 'travelator'::text]))),
    CONSTRAINT station_equipment_source_registered CHECK ((source_feed = ANY (ARRAY['openstation_netex'::text, 'kvb_aufzuege'::text, 'kvb_fahrtreppen'::text]))),
    CONSTRAINT station_equipment_stop_place_known CHECK (((stop_place_id IS NOT NULL) OR (source_feed = ANY (ARRAY['kvb_aufzuege'::text, 'kvb_fahrtreppen'::text]))))
);

CREATE VIEW public.station_equipment_live AS
 SELECT equipment_id,
    kind,
    equipment_no,
    stop_place_id,
    eva_no,
    station_name,
    description,
    info_url,
    wheelchair_passable,
    first_seen_at,
    last_seen_at,
    source_feed,
        CASE
            WHEN ((source_feed ~~ 'kvb\_%'::text) AND ((extras ->> 'lat'::text) ~ '^-?[0-9]{1,3}(\.[0-9]+)?$'::text)) THEN ((extras ->> 'lat'::text))::double precision
            ELSE NULL::double precision
        END AS unit_lat,
        CASE
            WHEN ((source_feed ~~ 'kvb\_%'::text) AND ((extras ->> 'lon'::text) ~ '^-?[0-9]{1,3}(\.[0-9]+)?$'::text)) THEN ((extras ->> 'lon'::text))::double precision
            ELSE NULL::double precision
        END AS unit_lon
   FROM public.station_equipment
  WHERE (closed_at IS NULL);

CREATE TABLE public.station_equipment_state (
    equipment_id text NOT NULL,
    status text NOT NULL,
    state text NOT NULL,
    status_description text,
    status_since timestamp with time zone NOT NULL,
    feed_ts timestamp with time zone,
    last_seen_at timestamp with time zone NOT NULL,
    known_equipment boolean NOT NULL,
    source_feed text NOT NULL,
    source_publisher text NOT NULL,
    source_run_id bigint,
    provider_updated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT station_equipment_state_known CHECK ((state = ANY (ARRAY['active'::text, 'inactive'::text, 'unknown'::text]))),
    CONSTRAINT station_equipment_state_source_registered CHECK ((source_feed = ANY (ARRAY['openstation_siri_fm'::text, 'kvb_aufzugsstoerung'::text, 'kvb_fahrtreppenstoerung'::text])))
);

CREATE TABLE public.station_equipment_ticks (
    observed_at timestamp with time zone NOT NULL,
    equipment_id text NOT NULL,
    status text NOT NULL,
    state text NOT NULL,
    previous_state text,
    status_description text,
    feed_ts timestamp with time zone,
    known_equipment boolean NOT NULL,
    source_run_id bigint,
    CONSTRAINT station_equipment_ticks_previous_known CHECK (((previous_state IS NULL) OR (previous_state = ANY (ARRAY['active'::text, 'inactive'::text, 'unknown'::text])))),
    CONSTRAINT station_equipment_ticks_state_known CHECK ((state = ANY (ARRAY['active'::text, 'inactive'::text, 'unknown'::text])))
)
PARTITION BY RANGE (observed_at);

CREATE TABLE public.station_slugs (
    slug text NOT NULL,
    station_no text NOT NULL,
    name text NOT NULL,
    assigned_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT station_slugs_slug_check CHECK (((slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text) AND (length(slug) <= 80) AND (slug !~ '[0-9]{5}'::text)))
);

CREATE VIEW public.station_index_live AS
 SELECT s.station_no,
    cur.slug,
    s.name,
    s.eva_no,
    s.eva_nos,
    s.ds100,
    s.ifopt,
    s.category,
    s.federal_state,
    s.municipality_code,
    s.street,
    s.zipcode,
    s.city,
    s.geom,
    s.stepless_access,
    s.has_parking,
    s.has_bicycle_parking,
    s.has_local_public_transport,
    s.has_public_facilities,
    s.has_locker_system,
    s.has_taxi_rank,
    s.has_travel_necessities,
    s.has_wifi,
    s.has_travel_center,
    s.has_railway_mission,
    s.has_db_lounge,
    s.has_lost_and_found,
    s.has_car_rental,
    s.mobility_service,
    s.mobility_staff,
    s.db_information,
    s.local_service_staff,
    s.service_phone,
    s.last_seen_at,
    s.updated_at,
    s.source_id
   FROM (public.db_stations s
     JOIN LATERAL ( SELECT g.slug
           FROM public.station_slugs g
          WHERE (g.station_no = s.station_no)
          ORDER BY g.assigned_at DESC, g.slug
         LIMIT 1) cur ON (true))
  WHERE (s.closed_at IS NULL);

CREATE TABLE public.station_metro_osm (
    dhid text NOT NULL,
    osm_type text NOT NULL,
    osm_id bigint NOT NULL,
    kind text NOT NULL,
    metres integer NOT NULL,
    extract_date date NOT NULL,
    source_id text DEFAULT 'osm'::text NOT NULL,
    matched_at timestamp with time zone NOT NULL,
    decisive boolean DEFAULT true NOT NULL,
    CONSTRAINT station_metro_osm_dhid CHECK ((dhid ~ '^de:[0-9]{5}:[^:_ ]{1,40}$'::text)),
    CONSTRAINT station_metro_osm_kind CHECK ((kind = ANY (ARRAY['subway'::text, 'light_rail_underground'::text]))),
    CONSTRAINT station_metro_osm_licence CHECK ((source_id = 'osm'::text)),
    CONSTRAINT station_metro_osm_metres CHECK (((metres >= 0) AND (metres <= 1000))),
    CONSTRAINT station_metro_osm_node CHECK (((osm_type = 'node'::text) AND (osm_id > 0)))
);

CREATE VIEW public.station_metro_osm_decided AS
 SELECT dhid
   FROM public.station_metro_osm
  WHERE decisive;

CREATE TABLE public.stop_access_odbl (
    source_feed text NOT NULL,
    dhid text NOT NULL,
    source_stop_ids text[] NOT NULL,
    name text NOT NULL,
    geom public.geography(Point,4326),
    quays integer DEFAULT 0 NOT NULL,
    quays_rail integer DEFAULT 0 NOT NULL,
    quays_height_known integer DEFAULT 0 NOT NULL,
    quay_height_min_cm numeric(6,1),
    quay_height_max_cm numeric(6,1),
    quays_high_kerb integer DEFAULT 0 NOT NULL,
    quays_tactile integer DEFAULT 0 NOT NULL,
    quays_portable_ramp integer DEFAULT 0 NOT NULL,
    quays_platform_lift integer DEFAULT 0 NOT NULL,
    lifts integer DEFAULT 0 NOT NULL,
    lift_cabin_min_width_cm integer,
    lift_cabin_min_length_cm integer,
    ramps integer DEFAULT 0 NOT NULL,
    ramp_max_slope_pct numeric(5,1),
    stairs integer DEFAULT 0 NOT NULL,
    escalators integer DEFAULT 0 NOT NULL,
    published_at timestamp with time zone,
    source_publisher text NOT NULL,
    provider_updated_at timestamp with time zone,
    first_seen_at timestamp with time zone NOT NULL,
    last_seen_at timestamp with time zone NOT NULL,
    closed_at timestamp with time zone,
    source_run_id bigint,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT stop_access_odbl_counts CHECK (((quays >= 0) AND ((quays_rail >= 0) AND (quays_rail <= quays)) AND ((quays_height_known >= 0) AND (quays_height_known <= quays)) AND ((quays_high_kerb >= 0) AND (quays_high_kerb <= quays)) AND ((quays_tactile >= 0) AND (quays_tactile <= quays)) AND ((quays_portable_ramp >= 0) AND (quays_portable_ramp <= quays)) AND ((quays_platform_lift >= 0) AND (quays_platform_lift <= quays)) AND (lifts >= 0) AND (ramps >= 0) AND (stairs >= 0) AND (escalators >= 0))),
    CONSTRAINT stop_access_odbl_licence CHECK ((source_feed = 'tuc_vdv462'::text))
);

CREATE VIEW public.stop_times_live AS
 SELECT arrival,
    departure,
    deleted_at,
    deleted_run_id,
    stop_sequence,
    gtfs_feed_key,
    pickup_type,
    drop_off_type,
    trip_id,
    stop_id,
    deleted_reason
   FROM public.stop_times
  WHERE (deleted_at IS NULL);

CREATE TABLE public.stops (
    deleted_at timestamp with time zone,
    deleted_run_id bigint,
    gtfs_feed_key smallint NOT NULL,
    location_type smallint DEFAULT 0 NOT NULL,
    id text NOT NULL,
    name text NOT NULL,
    parent_id text,
    platform_code text,
    deleted_reason text,
    geom public.geography(Point,4326) NOT NULL,
    extras jsonb DEFAULT '{}'::jsonb NOT NULL
);

CREATE VIEW public.stops_live AS
 SELECT deleted_at,
    deleted_run_id,
    gtfs_feed_key,
    location_type,
    id,
    name,
    parent_id,
    platform_code,
    deleted_reason,
    geom,
    extras
   FROM public.stops
  WHERE (deleted_at IS NULL);

CREATE TABLE public.street_bay_state (
    bay_id text NOT NULL,
    state text NOT NULL,
    message_at timestamp with time zone NOT NULL,
    last_seen_at timestamp with time zone NOT NULL,
    source_feed text NOT NULL,
    source_publisher text NOT NULL,
    source_run_id bigint,
    provider_updated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT street_bay_state_known CHECK ((state = ANY (ARRAY['free'::text, 'occupied'::text]))),
    CONSTRAINT street_bay_state_source_registered CHECK ((source_feed = 'dortmund_parksensoren'::text))
);

CREATE TABLE public.street_bay_ticks (
    observed_at timestamp with time zone NOT NULL,
    bay_id text NOT NULL,
    state text NOT NULL,
    previous_state text,
    message_at timestamp with time zone NOT NULL,
    source_run_id bigint
)
PARTITION BY RANGE (observed_at);

CREATE TABLE public.street_bays (
    bay_id text NOT NULL,
    external_id text NOT NULL,
    kind text NOT NULL,
    publisher_kind text,
    street text,
    house_number text,
    postcode text,
    city text,
    charge_point_operator text,
    geom public.geography(Point,4326) NOT NULL,
    last_message_at timestamp with time zone,
    first_seen_at timestamp with time zone NOT NULL,
    last_seen_at timestamp with time zone NOT NULL,
    closed_at timestamp with time zone,
    source_feed text NOT NULL,
    source_publisher text NOT NULL,
    source_run_id bigint,
    provider_updated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    spaces integer,
    reserved_when text,
    CONSTRAINT street_bays_id_shape CHECK ((bay_id = ((split_part(source_feed, '_'::text, 1) || ':'::text) || external_id))),
    CONSTRAINT street_bays_kind_known CHECK ((kind = ANY (ARRAY['disabled'::text, 'ev_charging'::text, 'loading'::text, 'regular'::text, 'unspecified'::text]))),
    CONSTRAINT street_bays_postcode_five_digits CHECK ((postcode ~ '^[0-9]{5}$'::text)),
    CONSTRAINT street_bays_source_registered CHECK ((source_feed = ANY (ARRAY['dortmund_parksensoren_bays'::text, 'frankfurt_behindertenparkplaetze'::text]))),
    CONSTRAINT street_bays_spaces_counted CHECK (((spaces IS NULL) OR ((spaces >= 1) AND (spaces <= 99))))
);

CREATE VIEW public.street_bays_live AS
 SELECT b.bay_id,
    b.kind,
    b.publisher_kind,
    b.street,
    b.house_number,
    b.postcode,
    b.city,
    b.charge_point_operator,
    b.geom,
    b.source_feed,
    t.state,
    t.message_at,
    t.source_feed AS state_feed,
    b.spaces,
    b.reserved_when
   FROM (public.street_bays b
     LEFT JOIN public.street_bay_state t ON ((t.bay_id = b.bay_id)))
  WHERE (b.closed_at IS NULL);

CREATE TABLE public.tick_storage_days (
    table_name text NOT NULL,
    day date NOT NULL,
    bytes bigint NOT NULL,
    measured_at timestamp with time zone NOT NULL,
    CONSTRAINT tick_storage_days_bytes_check CHECK ((bytes >= 0))
);

CREATE TABLE public.traffic_count_latest (
    site_id bigint NOT NULL,
    measure text NOT NULL,
    interval_start timestamp with time zone NOT NULL,
    interval_end timestamp with time zone NOT NULL,
    vehicles integer NOT NULL,
    result_time timestamp with time zone NOT NULL,
    observed_at timestamp with time zone NOT NULL,
    source_feed text NOT NULL,
    source_publisher text NOT NULL,
    source_run_id bigint,
    provider_updated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT traffic_count_latest_count CHECK ((vehicles >= 0)),
    CONSTRAINT traffic_count_latest_feed_registered CHECK ((source_feed = 'hh_verkehrszaehlung'::text)),
    CONSTRAINT traffic_count_latest_interval CHECK ((interval_end > interval_start)),
    CONSTRAINT traffic_count_latest_measure CHECK ((measure = ANY (ARRAY['vehicles'::text, 'heavy'::text])))
);

CREATE TABLE public.traffic_count_sites (
    id bigint NOT NULL,
    source_feed text NOT NULL,
    site_key text NOT NULL,
    location_key text NOT NULL,
    section_key text NOT NULL,
    scope text NOT NULL,
    name text NOT NULL,
    direction text,
    geom public.geography(Point,4326) NOT NULL,
    vehicles_stream text,
    heavy_stream text,
    extras jsonb DEFAULT '{}'::jsonb NOT NULL,
    first_seen_at timestamp with time zone NOT NULL,
    last_seen_at timestamp with time zone NOT NULL,
    closed_at timestamp with time zone,
    source_publisher text NOT NULL,
    source_run_id bigint,
    provider_updated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT traffic_count_sites_a_stream CHECK (((vehicles_stream IS NOT NULL) OR (heavy_stream IS NOT NULL))),
    CONSTRAINT traffic_count_sites_feed_registered CHECK ((source_feed = ANY (ARRAY['hh_verkehrszaehlstellen'::text, 'berlin_verkehrsdetektion'::text]))),
    CONSTRAINT traffic_count_sites_scope CHECK ((scope = ANY (ARRAY['both'::text, 'one'::text])))
);

CREATE VIEW public.traffic_count_now_live AS
 SELECT s.id AS site_id,
    s.source_feed AS feed_key,
    s.location_key,
    s.section_key,
    s.scope,
    s.name,
    s.direction,
    s.geom,
    v.interval_start,
    v.interval_end,
    v.vehicles,
    v.result_time,
    h.interval_start AS heavy_interval_start,
    h.vehicles AS heavy
   FROM ((public.traffic_count_sites s
     LEFT JOIN public.traffic_count_latest v ON (((v.site_id = s.id) AND (v.measure = 'vehicles'::text))))
     LEFT JOIN public.traffic_count_latest h ON (((h.site_id = s.id) AND (h.measure = 'heavy'::text))))
  WHERE (s.closed_at IS NULL);

CREATE TABLE public.traffic_count_profiles (
    site_id bigint NOT NULL,
    month date NOT NULL,
    day_kind text NOT NULL,
    hour smallint NOT NULL,
    vehicles integer NOT NULL,
    heavy integer,
    speed_kmh numeric(5,1),
    days smallint NOT NULL,
    source_feed text NOT NULL,
    source_publisher text NOT NULL,
    source_run_id bigint,
    provider_updated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT traffic_count_profiles_counts CHECK (((vehicles >= 0) AND ((heavy IS NULL) OR (heavy >= 0)) AND ((speed_kmh IS NULL) OR (speed_kmh >= (0)::numeric)))),
    CONSTRAINT traffic_count_profiles_day_kind CHECK ((day_kind = ANY (ARRAY['workday'::text, 'saturday'::text, 'sunday_holiday'::text]))),
    CONSTRAINT traffic_count_profiles_days CHECK ((days >= 3)),
    CONSTRAINT traffic_count_profiles_feed_registered CHECK ((source_feed = 'berlin_verkehrsdetektion'::text)),
    CONSTRAINT traffic_count_profiles_hour CHECK (((hour >= 0) AND (hour <= 23))),
    CONSTRAINT traffic_count_profiles_month CHECK ((EXTRACT(day FROM month) = (1)::numeric))
);

CREATE VIEW public.traffic_count_profiles_live AS
 WITH newest AS (
         SELECT traffic_count_profiles.source_feed,
            max(traffic_count_profiles.month) AS month
           FROM public.traffic_count_profiles
          GROUP BY traffic_count_profiles.source_feed
        )
 SELECT s.id AS site_id,
    s.source_feed AS feed_key,
    s.location_key,
    s.section_key,
    s.name,
    s.direction,
    s.geom,
    (s.extras ->> 'street'::text) AS street,
    (s.extras ->> 'towards'::text) AS towards,
    p.month,
    p.day_kind,
    p.hour,
    p.vehicles,
    p.heavy,
    p.speed_kmh,
    p.days,
    p.provider_updated_at
   FROM ((public.traffic_count_profiles p
     JOIN newest n ON (((n.source_feed = p.source_feed) AND (n.month = p.month))))
     JOIN public.traffic_count_sites s ON (((s.id = p.site_id) AND (s.closed_at IS NULL))));

CREATE SEQUENCE public.traffic_count_sites_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.traffic_count_sites_id_seq OWNED BY public.traffic_count_sites.id;

CREATE TABLE public.traffic_count_ticks (
    observed_at timestamp with time zone NOT NULL,
    site_id bigint NOT NULL,
    measure text NOT NULL,
    interval_start timestamp with time zone NOT NULL,
    interval_end timestamp with time zone NOT NULL,
    vehicles integer NOT NULL,
    result_time timestamp with time zone NOT NULL,
    source_feed text NOT NULL,
    source_run_id bigint
)
PARTITION BY RANGE (observed_at);

CREATE TABLE public.transit_delays (
    observed_at timestamp with time zone NOT NULL,
    feed_ts timestamp with time zone NOT NULL,
    trip_id text NOT NULL,
    stop_id text,
    stop_sequence integer,
    delay_s integer,
    schedule_relationship text DEFAULT 'SCHEDULED'::text NOT NULL,
    source text DEFAULT 'delfi_rt_tu'::text NOT NULL,
    raw jsonb,
    source_run_id bigint
)
PARTITION BY RANGE (observed_at);

CREATE VIEW public.transit_delays_live AS
 SELECT DISTINCT ON (trip_id, stop_sequence) trip_id,
    stop_id,
    stop_sequence,
    delay_s,
    schedule_relationship,
        CASE
            WHEN (jsonb_typeof((raw -> 'departure_time'::text)) = 'number'::text) THEN to_timestamp(((raw ->> 'departure_time'::text))::double precision)
            WHEN (jsonb_typeof((raw -> 'arrival_time'::text)) = 'number'::text) THEN to_timestamp(((raw ->> 'arrival_time'::text))::double precision)
            ELSE NULL::timestamp with time zone
        END AS event_at,
        CASE
            WHEN (stop_sequence IS NULL) THEN (raw ->> 'start_date'::text)
            ELSE NULL::text
        END AS start_date,
    observed_at
   FROM public.transit_delays d
  WHERE ((observed_at > (now() - '06:00:00'::interval)) AND (observed_at <= now()) AND (source = 'delfi_rt_tu'::text))
  ORDER BY trip_id, stop_sequence, observed_at DESC;

CREATE VIEW public.transit_departures_odbl_live AS
 SELECT st.stop_id,
    d.service_date,
    public.transit_odbl_departs_at(d.service_date, COALESCE(a.agency_timezone, 'Europe/Berlin'::text), st.departure_s) AS departs_at,
    st.stop_sequence,
    COALESCE(st.stop_headsign, t.trip_headsign) AS headsign,
    t.external_id AS trip_id,
    t.trip_short_name,
    t.wheelchair_accessible,
    t.bikes_allowed,
    r.route_short_name,
    r.route_long_name,
    r.route_type,
    a.agency_name,
    u.at_stop AS rt_at_stop,
    COALESCE(u.departure_delay_s, u.arrival_delay_s, u.trip_delay_s) AS rt_delay_s,
        CASE
            WHEN u.at_stop THEN COALESCE(u.departure_at, u.arrival_at)
            ELSE NULL::timestamp with time zone
        END AS rt_departs_at,
    COALESCE((u.trip_relationship = ANY (ARRAY['CANCELED'::text, 'DELETED'::text])), false) AS rt_trip_cancelled,
    COALESCE((u.at_stop AND (u.stop_relationship = 'SKIPPED'::text)), false) AS rt_stop_skipped,
    u.observed_at AS rt_observed_at,
    st.feed_version,
    st.departure_s
   FROM (((((domains.transit_stop_times_odbl st
     JOIN domains.transit_trips_odbl t ON (((t.external_id = st.trip_id) AND (t.feed_version = st.feed_version) AND (t.closed_at IS NULL))))
     JOIN domains.transit_service_dates_odbl d ON (((d.service_id = t.service_id) AND (d.feed_version = t.feed_version) AND (d.closed_at IS NULL) AND ((d.service_date >= (((now() AT TIME ZONE 'UTC'::text))::date - 1)) AND (d.service_date <= (((now() AT TIME ZONE 'UTC'::text))::date + 2))))))
     LEFT JOIN domains.transit_routes_odbl r ON (((r.external_id = t.route_id) AND (r.feed_version = t.feed_version) AND (r.closed_at IS NULL))))
     LEFT JOIN LATERAL ( SELECT ag.agency_name,
            ag.agency_timezone
           FROM domains.transit_agencies_odbl ag
          WHERE ((ag.feed_version = t.feed_version) AND (ag.closed_at IS NULL) AND ((r.agency_id IS NULL) OR (ag.external_id = r.agency_id)))
          ORDER BY ag.external_id
         LIMIT 1) a ON (true))
     LEFT JOIN LATERAL ( SELECT COALESCE((x.stop_id = st.stop_id), false) AS at_stop,
            x.departure_delay_s,
            x.arrival_delay_s,
            x.trip_delay_s,
            x.departure_at,
            x.arrival_at,
            x.trip_relationship,
            x.stop_relationship,
            x.observed_at
           FROM domains.transit_trip_updates_odbl x
          WHERE ((x.trip_id = t.external_id) AND (x.start_date = d.service_date) AND (x.closed_at IS NULL) AND ((x.stop_id = st.stop_id) OR (x.stop_sequence <= st.stop_sequence) OR ((x.stop_id IS NULL) AND (x.stop_sequence IS NULL))))
          ORDER BY (x.stop_id = st.stop_id) DESC NULLS LAST, x.stop_sequence DESC NULLS LAST, x.observed_at DESC
         LIMIT 1) u ON (true))
  WHERE ((st.closed_at IS NULL) AND (st.departure_s IS NOT NULL) AND (COALESCE(st.pickup_type, 0) <> 1) AND (EXISTS ( SELECT 1
           FROM domains.transit_stop_times_odbl n
          WHERE ((n.trip_id = st.trip_id) AND (n.feed_version = st.feed_version) AND (n.stop_sequence > st.stop_sequence) AND (n.closed_at IS NULL)))));

CREATE VIEW public.transit_odbl_service_days_live AS
 SELECT k.service_date,
    z.tz,
    public.transit_odbl_departs_at(k.service_date, z.tz, 0) AS day_starts_at
   FROM (( SELECT (((now() AT TIME ZONE 'UTC'::text))::date + o.o) AS service_date
           FROM generate_series('-1'::integer, 2) o(o)) k
     CROSS JOIN ( SELECT 'Europe/Berlin'::text AS tz
        UNION
         SELECT ag.agency_timezone
           FROM domains.transit_agencies_odbl ag
          WHERE ((ag.closed_at IS NULL) AND (ag.agency_timezone IS NOT NULL))) z);

CREATE VIEW public.transit_punctuality_area_live AS
 WITH per_land AS MATERIALIZED (
         SELECT l.land,
            x.level,
            x.area,
            x.trip_id,
            x.trips_observed,
            x.trips_late,
            x.trips_skipped_stop,
            x.trips_untimed,
            x.median_worst_delay_s,
            x.stops_seen,
            x.newest,
            x.late,
            x.worst,
            x.skipped,
            x.timed,
            x.untimed
           FROM (( VALUES ('01'::text), ('02'::text), ('03'::text), ('04'::text), ('05'::text), ('06'::text), ('07'::text), ('08'::text), ('09'::text), ('10'::text), ('11'::text), ('12'::text), ('13'::text), ('14'::text), ('15'::text), ('16'::text)) l(land)
             CROSS JOIN LATERAL ( WITH w AS MATERIALIZED (
                         SELECT d0.trip_id,
                            d0.stop_id,
                            d0.delay_s,
                            d0.schedule_relationship,
                            d0.observed_at,
                            "left"(split_part(d0.stop_id, ':'::text, 2), 5) AS kreis
                           FROM public.transit_delays d0
                          WHERE (("left"(
                                CASE
                                    WHEN ((d0.stop_id ~* '^de:[0-9]+(:|$)'::text) AND (length(split_part(d0.stop_id, ':'::text, 2)) = ANY (ARRAY[2, 3, 5, 8]))) THEN split_part(d0.stop_id, ':'::text, 2)
                                    ELSE NULL::text
                                END, 2) = l.land) AND (d0.observed_at >= (now() - '00:30:00'::interval)) AND (d0.observed_at <= now()) AND (d0.source = 'delfi_rt_tu'::text) AND ((d0.delay_s IS NOT NULL) OR (d0.schedule_relationship = 'SKIPPED'::text)))
                        ), tk AS (
                         SELECT w.trip_id,
                            w.kreis,
                            bool_or((w.delay_s > 300)) AS late,
                            max(w.delay_s) AS worst,
                            bool_or((w.schedule_relationship = 'SKIPPED'::text)) AS skipped,
                            bool_or((w.delay_s IS NOT NULL)) AS timed,
                            max(w.observed_at) AS newest
                           FROM w
                          GROUP BY w.trip_id, w.kreis
                        ), t0 AS (
                         SELECT tk.trip_id,
                            bool_or(tk.late) AS late,
                            max(tk.worst) AS worst,
                            bool_or(tk.skipped) AS skipped,
                            bool_or(tk.timed) AS timed,
                            max(tk.newest) AS newest
                           FROM tk
                          GROUP BY tk.trip_id
                        ), t AS (
                         SELECT t.trip_id,
                            t.late,
                            t.worst,
                            t.skipped,
                            t.timed,
                            t.newest,
                                CASE
                                    WHEN t.timed THEN (EXISTS ( SELECT 1
                                       FROM public.gtfs_untimed_trips u
                                      WHERE ((u.gtfs_feed_key = 1) AND (u.trip_id = t.trip_id))))
                                    ELSE false
                                END AS untimed
                           FROM t0 t
                        ), st AS (
                         SELECT ds.kreis,
                            (count(*))::integer AS stops
                           FROM ( SELECT DISTINCT w.kreis,
                                    w.stop_id
                                   FROM w
                                  WHERE (w.stop_id IS NOT NULL)) ds
                          GROUP BY ds.kreis
                        )
                 SELECT 'land'::text AS level,
                    l.land AS area,
                    NULL::text AS trip_id,
                    (count(*) FILTER (WHERE (t.timed AND (NOT t.untimed))))::integer AS trips_observed,
                    (count(*) FILTER (WHERE (t.timed AND t.late AND (NOT t.untimed))))::integer AS trips_late,
                    (count(*) FILTER (WHERE t.skipped))::integer AS trips_skipped_stop,
                    (count(*) FILTER (WHERE t.untimed))::integer AS trips_untimed,
                    (percentile_cont((0.5)::double precision) WITHIN GROUP (ORDER BY ((t.worst)::double precision)) FILTER (WHERE (NOT t.untimed)))::integer AS median_worst_delay_s,
                    (COALESCE(( SELECT sum(s.stops) AS sum
                           FROM st s), (0)::bigint))::integer AS stops_seen,
                    max(t.newest) AS newest,
                    NULL::boolean AS late,
                    NULL::integer AS worst,
                    NULL::boolean AS skipped,
                    NULL::boolean AS timed,
                    NULL::boolean AS untimed
                   FROM t
                UNION ALL
                 SELECT 'kreis'::text,
                    tk.kreis,
                    NULL::text,
                    (count(*) FILTER (WHERE (tk.timed AND (NOT tu.untimed))))::integer AS count,
                    (count(*) FILTER (WHERE (tk.timed AND tk.late AND (NOT tu.untimed))))::integer AS count,
                    (count(*) FILTER (WHERE tk.skipped))::integer AS count,
                    (count(*) FILTER (WHERE tu.untimed))::integer AS count,
                    (percentile_cont((0.5)::double precision) WITHIN GROUP (ORDER BY ((tk.worst)::double precision)) FILTER (WHERE (NOT tu.untimed)))::integer AS percentile_cont,
                    COALESCE(( SELECT s.stops
                           FROM st s
                          WHERE (s.kreis = tk.kreis)), 0) AS "coalesce",
                    max(tk.newest) AS max,
                    NULL::boolean,
                    NULL::integer,
                    NULL::boolean,
                    NULL::boolean,
                    NULL::boolean
                   FROM (tk
                     JOIN t tu ON ((tu.trip_id = tk.trip_id)))
                  GROUP BY tk.kreis
                UNION ALL
                 SELECT 'trip'::text,
                    l.land,
                    t.trip_id,
                    NULL::integer,
                    NULL::integer,
                    NULL::integer,
                    NULL::integer,
                    NULL::integer,
                    NULL::integer,
                    t.newest,
                    t.late,
                    t.worst,
                    t.skipped,
                    t.timed,
                    t.untimed
                   FROM t) x)
        ), nation AS (
         SELECT bool_or(p.late) AS late,
            max(p.worst) AS worst,
            bool_or(p.skipped) AS skipped,
            bool_or(p.timed) AS timed,
            bool_or(p.untimed) AS untimed,
            max(p.newest) AS newest
           FROM per_land p
          WHERE (p.level = 'trip'::text)
          GROUP BY p.trip_id
        ), kreis_rows AS MATERIALIZED (
         SELECT p.land,
            p.level,
            p.area,
            p.trip_id,
            p.trips_observed,
            p.trips_late,
            p.trips_skipped_stop,
            p.trips_untimed,
            p.median_worst_delay_s,
            p.stops_seen,
            p.newest,
            p.late,
            p.worst,
            p.skipped,
            p.timed,
            p.untimed
           FROM per_land p
          WHERE (p.level = 'kreis'::text)
        ), cities AS MATERIALIZED (
         SELECT "left"(g.admin_code, 5) AS kreis,
            min(g.name) AS name
           FROM public.gazetteer_places g
          WHERE ((g.source_id = 'bkg_gvisys'::text) AND (g.kind = 'city'::text) AND (g.closed_at IS NULL) AND (g.admin_code ~ '^[0-9]{5}000$'::text))
          GROUP BY ("left"(g.admin_code, 5))
        ), districts AS MATERIALIZED (
         SELECT g.admin_code AS kreis,
            min(g.name) AS name
           FROM public.gazetteer_places g
          WHERE ((g.source_id = 'bkg_gvisys'::text) AND (g.kind = 'district'::text) AND (g.closed_at IS NULL) AND (g.admin_code ~ '^[0-9]{5}$'::text))
          GROUP BY g.admin_code
        )
 SELECT 'all'::text AS level,
    'de'::text AS area,
    NULL::text AS name,
    (count(*) FILTER (WHERE (n.timed AND (NOT n.untimed))))::integer AS trips_observed,
    (count(*) FILTER (WHERE (n.timed AND n.late AND (NOT n.untimed))))::integer AS trips_late,
    (count(*) FILTER (WHERE n.skipped))::integer AS trips_skipped_stop,
    (count(*) FILTER (WHERE n.untimed))::integer AS trips_untimed,
    (percentile_cont((0.5)::double precision) WITHIN GROUP (ORDER BY ((n.worst)::double precision)) FILTER (WHERE (NOT n.untimed)))::integer AS median_worst_delay_s,
    ( SELECT (COALESCE(sum(p.stops_seen), (0)::bigint))::integer AS "coalesce"
           FROM per_land p
          WHERE (p.level = 'land'::text)) AS stops_seen,
    max(n.newest) AS newest
   FROM nation n
UNION ALL
 SELECT 'land'::text AS level,
    p.area,
    NULL::text AS name,
    p.trips_observed,
    p.trips_late,
    p.trips_skipped_stop,
    p.trips_untimed,
    p.median_worst_delay_s,
    p.stops_seen,
    p.newest
   FROM per_land p
  WHERE (p.level = 'land'::text)
UNION ALL
 SELECT 'city'::text AS level,
    p.area,
    c.name,
    p.trips_observed,
    p.trips_late,
    p.trips_skipped_stop,
    p.trips_untimed,
    p.median_worst_delay_s,
    p.stops_seen,
    p.newest
   FROM (kreis_rows p
     JOIN cities c ON ((c.kreis = p.area)))
UNION ALL
 SELECT 'kreis'::text AS level,
    p.area,
    d.name,
    p.trips_observed,
    p.trips_late,
    p.trips_skipped_stop,
    p.trips_untimed,
    p.median_worst_delay_s,
    p.stops_seen,
    p.newest
   FROM (kreis_rows p
     JOIN districts d ON ((d.kreis = p.area)))
  WHERE (NOT (EXISTS ( SELECT 1
           FROM cities c
          WHERE (c.kreis = p.area))));

CREATE VIEW public.transit_punctuality_live AS
 SELECT l.land,
    t.trips_observed,
    t.trips_late,
    t.newest
   FROM (( VALUES ('01'::text), ('02'::text), ('03'::text), ('04'::text), ('05'::text), ('06'::text), ('07'::text), ('08'::text), ('09'::text), ('10'::text), ('11'::text), ('12'::text), ('13'::text), ('14'::text), ('15'::text), ('16'::text)) l(land)
     CROSS JOIN LATERAL ( SELECT (count(*))::integer AS trips_observed,
            (count(*) FILTER (WHERE p.late))::integer AS trips_late,
            max(p.newest) AS newest
           FROM ( SELECT d.trip_id,
                    bool_or((d.delay_s > 300)) AS late,
                    max(d.observed_at) AS newest
                   FROM ( SELECT d0.trip_id,
                            d0.delay_s,
                            d0.observed_at
                           FROM public.transit_delays d0
                          WHERE (("left"(
                                CASE
                                    WHEN ((d0.stop_id ~* '^de:[0-9]+(:|$)'::text) AND (length(split_part(d0.stop_id, ':'::text, 2)) = ANY (ARRAY[2, 3, 5, 8]))) THEN split_part(d0.stop_id, ':'::text, 2)
                                    ELSE NULL::text
                                END, 2) = l.land) AND (d0.observed_at >= (now() - '00:30:00'::interval)) AND (d0.observed_at <= now()) AND (d0.source = 'delfi_rt_tu'::text) AND (d0.delay_s IS NOT NULL))
                         OFFSET 0) d
                  GROUP BY d.trip_id) p) t)
  WHERE (t.trips_observed > 0);

CREATE VIEW public.transit_station_live AS
 SELECT s.ord,
    s.dhids[1] AS dhid,
    s.dhids,
    s.name,
    z.stops_known,
    z.trips_observed,
    z.trips_late,
    z.trips_skipped_stop,
    z.trips_untimed,
    z.median_worst_delay_s,
    z.newest
   FROM (( VALUES (1,ARRAY['de:11000:900003201'::text],'Berlin Hbf'::text), (2,ARRAY['de:02000:10950'::text],'Hamburg Hbf'::text), (3,ARRAY['de:09162:100'::text],'München Hbf'::text), (4,ARRAY['de:05315:11201'::text],'Köln Hbf'::text), (5,ARRAY['de:06412:10'::text],'Frankfurt (Main) Hbf'::text), (6,ARRAY['de:08111:6115'::text],'Stuttgart Hbf'::text), (7,ARRAY['de:05111:18235'::text],'Düsseldorf Hbf'::text), (8,ARRAY['de:14713:8010205'::text, 'de:14713:8098205'::text],'Leipzig Hbf'::text)) s(ord, dhids, name)
     CROSS JOIN LATERAL ( WITH ids AS MATERIALIZED (
                 SELECT st.id
                   FROM (unnest(s.dhids) h(dhid)
                     JOIN public.stops st ON (((st.gtfs_feed_key = 1) AND (st.deleted_at IS NULL) AND ((st.id = h.dhid) OR ((st.id ~>=~ (h.dhid || ':'::text)) AND (st.id ~<~ (h.dhid || ';'::text))) OR ((st.id ~>=~ (h.dhid || '_'::text)) AND (st.id ~<~ (h.dhid || '`'::text)))))))
                ), w AS MATERIALIZED (
                 SELECT d.trip_id,
                    d.delay_s,
                    d.schedule_relationship,
                    d.observed_at
                   FROM public.transit_delays d
                  WHERE ((d.stop_id IN ( SELECT ids.id
                           FROM ids)) AND (d.observed_at >= (now() - '00:30:00'::interval)) AND (d.observed_at <= now()) AND (d.source = 'delfi_rt_tu'::text) AND ((d.delay_s IS NOT NULL) OR (d.schedule_relationship = 'SKIPPED'::text)))
                ), t0 AS (
                 SELECT w.trip_id,
                    bool_or((w.delay_s > 300)) AS late,
                    max(w.delay_s) AS worst,
                    bool_or((w.schedule_relationship = 'SKIPPED'::text)) AS skipped,
                    bool_or((w.delay_s IS NOT NULL)) AS timed,
                    max(w.observed_at) AS newest
                   FROM w
                  GROUP BY w.trip_id
                ), t AS (
                 SELECT t_1.trip_id,
                    t_1.late,
                    t_1.worst,
                    t_1.skipped,
                    t_1.timed,
                    t_1.newest,
                        CASE
                            WHEN t_1.timed THEN (EXISTS ( SELECT 1
                               FROM public.gtfs_untimed_trips u
                              WHERE ((u.gtfs_feed_key = 1) AND (u.trip_id = t_1.trip_id))))
                            ELSE false
                        END AS untimed
                   FROM t0 t_1
                )
         SELECT (( SELECT count(*) AS count
                   FROM ids))::integer AS stops_known,
            (count(*) FILTER (WHERE (t.timed AND (NOT t.untimed))))::integer AS trips_observed,
            (count(*) FILTER (WHERE (t.timed AND t.late AND (NOT t.untimed))))::integer AS trips_late,
            (count(*) FILTER (WHERE t.skipped))::integer AS trips_skipped_stop,
            (count(*) FILTER (WHERE t.untimed))::integer AS trips_untimed,
            (percentile_cont((0.5)::double precision) WITHIN GROUP (ORDER BY ((t.worst)::double precision)) FILTER (WHERE (t.timed AND (NOT t.untimed))))::integer AS median_worst_delay_s,
            max(t.newest) AS newest
           FROM t) z);

CREATE MATERIALIZED VIEW public.transit_stop_modes AS
 WITH served AS (
         SELECT st.gtfs_feed_key,
            (st.stop_id COLLATE "C") AS stop_id,
            (t.route_id COLLATE "C") AS route_id
           FROM (public.stop_times st
             JOIN public.trips t ON (((t.gtfs_feed_key = st.gtfs_feed_key) AND (t.id = (st.trip_id COLLATE "C")) AND (t.deleted_at IS NULL))))
          WHERE (st.deleted_at IS NULL)
          GROUP BY st.gtfs_feed_key, (st.stop_id COLLATE "C"), (t.route_id COLLATE "C")
        ), typed AS (
         SELECT v.gtfs_feed_key,
            COALESCE(s.parent_id, s.id) AS root_id,
            s.id AS stop_id,
            s.name,
            s.geom,
                CASE
                    WHEN (r.route_type = 109) THEN 'sbahn'::text
                    WHEN ((r.route_type = 2) OR ((r.route_type >= 100) AND (r.route_type <= 199))) THEN 'rail'::text
                    WHEN ((r.route_type = 1) OR ((r.route_type >= 400) AND (r.route_type <= 405))) THEN 'subway'::text
                    WHEN ((r.route_type = 0) OR ((r.route_type >= 900) AND (r.route_type <= 906))) THEN 'tram'::text
                    WHEN ((r.route_type = ANY (ARRAY[3, 11, 800])) OR ((r.route_type >= 200) AND (r.route_type <= 209)) OR ((r.route_type >= 700) AND (r.route_type <= 716))) THEN 'bus'::text
                    WHEN ((r.route_type = 4) OR ((r.route_type >= 1000) AND (r.route_type <= 1021)) OR (r.route_type = 1200)) THEN 'ferry'::text
                    ELSE 'other'::text
                END AS mode,
            NULLIF(btrim(r.short_name), ''::text) AS line
           FROM ((served v
             JOIN public.stops s ON (((s.gtfs_feed_key = v.gtfs_feed_key) AND (s.id = (v.stop_id COLLATE "C")) AND (s.deleted_at IS NULL))))
             JOIN public.routes r ON (((r.gtfs_feed_key = v.gtfs_feed_key) AND (r.id = (v.route_id COLLATE "C")) AND (r.deleted_at IS NULL))))
        ), families AS (
         SELECT typed.gtfs_feed_key,
            typed.root_id,
            array_agg(DISTINCT typed.mode ORDER BY typed.mode) FILTER (WHERE (typed.mode <> 'other'::text)) AS modes,
            array_agg(DISTINCT typed.line ORDER BY typed.line) FILTER (WHERE (typed.line IS NOT NULL)) AS lines,
            array_agg(DISTINCT typed.stop_id ORDER BY typed.stop_id) AS stop_ids,
            min(typed.name) AS child_name,
            public.st_centroid(public.st_collect((typed.geom)::public.geometry)) AS centre
           FROM typed
          GROUP BY typed.gtfs_feed_key, typed.root_id
        )
 SELECT f.gtfs_feed_key,
    f.root_id,
    COALESCE(p.name, f.child_name) AS name,
    COALESCE(p.geom, (f.centre)::public.geography) AS geom,
    f.modes,
    COALESCE(f.lines[1:200], '{}'::text[]) AS lines,
    f.stop_ids
   FROM (families f
     LEFT JOIN public.stops p ON (((p.gtfs_feed_key = f.gtfs_feed_key) AND (p.id = f.root_id) AND (p.deleted_at IS NULL))))
  WHERE (f.modes IS NOT NULL)
  WITH NO DATA;

CREATE VIEW public.transit_stops_odbl_live AS
 SELECT external_id AS stop_id,
    stop_name,
    stop_code,
    location_type,
    parent_station,
    platform_code,
    wheelchair_boarding,
    geom,
    feed_version,
    source_id
   FROM domains.transit_stops_odbl s
  WHERE ((closed_at IS NULL) AND (geom IS NOT NULL));

CREATE TABLE public.translation_cache (
    key text NOT NULL,
    lang text NOT NULL,
    model text NOT NULL,
    text text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_used_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT translation_cache_check CHECK ((last_used_at >= created_at)),
    CONSTRAINT translation_cache_key_check CHECK ((key ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT translation_cache_lang_check CHECK ((lang = ANY (ARRAY['en'::text, 'ru'::text, 'bg'::text, 'uk'::text, 'ro'::text, 'tr'::text, 'fr'::text, 'es'::text, 'nl'::text, 'pl'::text, 'it'::text, 'lt'::text, 'cs'::text, 'hu'::text, 'sk'::text, 'da'::text, 'pt'::text, 'hr'::text, 'sr'::text, 'el'::text, 'lv'::text]))),
    CONSTRAINT translation_cache_model_check CHECK ((model ~ '^[a-z0-9][a-z0-9.@+_-]{2,199}$'::text)),
    CONSTRAINT translation_cache_text_check CHECK (((length(text) >= 1) AND (length(text) <= 4000)))
);

CREATE VIEW public.trips_live AS
 SELECT deleted_at,
    deleted_run_id,
    loaded_run_id,
    gtfs_feed_key,
    direction_id,
    id,
    route_id,
    service_id,
    headsign,
    shape_id,
    deleted_reason,
    stop_times_fp,
    trip_short_name
   FROM public.trips
  WHERE (deleted_at IS NULL);

CREATE TABLE public.validator_horizon (
    id smallint DEFAULT 1 NOT NULL,
    not_before timestamp with time zone NOT NULL,
    reason text NOT NULL,
    set_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT validator_horizon_id_check CHECK ((id = 1)),
    CONSTRAINT validator_horizon_reason_check CHECK ((reason <> ''::text))
);

CREATE TABLE public.vbb_transit_delays (
    observed_at timestamp with time zone NOT NULL,
    feed_ts timestamp with time zone NOT NULL,
    trip_id text NOT NULL,
    stop_id text,
    stop_sequence integer,
    delay_s integer,
    schedule_relationship text DEFAULT 'SCHEDULED'::text NOT NULL,
    source text DEFAULT 'vbb_rt'::text NOT NULL,
    raw jsonb,
    source_run_id bigint,
    CONSTRAINT vbb_transit_delays_licence CHECK ((source = 'vbb_rt'::text))
)
PARTITION BY RANGE (observed_at);

CREATE VIEW public.vbb_transit_delays_live AS
 SELECT observed_at,
    feed_ts,
    trip_id,
    stop_id,
    delay_s,
    schedule_relationship,
    source
   FROM public.vbb_transit_delays d
  WHERE (observed_at >= (now() - '03:00:00'::interval));

CREATE TABLE public.vbn_siri_et_calls (
    observed_at timestamp with time zone NOT NULL,
    feed_ts timestamp with time zone,
    service_day date NOT NULL,
    journey_ref text NOT NULL,
    stop_ref text NOT NULL,
    visit smallint NOT NULL,
    line text,
    category text,
    operator_ref text,
    destination text,
    aimed_arr timestamp with time zone,
    expected_arr timestamp with time zone,
    aimed_dep timestamp with time zone,
    expected_dep timestamp with time zone,
    delay_s integer,
    platform text,
    recorded boolean DEFAULT false NOT NULL,
    cancelled boolean DEFAULT false NOT NULL,
    journey_cancelled boolean DEFAULT false NOT NULL,
    extra boolean DEFAULT false NOT NULL,
    source_id text DEFAULT 'vbn_siri_et'::text NOT NULL,
    source_run_id bigint,
    source_feed text DEFAULT 'vbn_siri_et'::text NOT NULL,
    vehicle_mode text,
    CONSTRAINT vbn_siri_et_calls_delay CHECK (((delay_s IS NULL) OR (abs(delay_s) <= 21600))),
    CONSTRAINT vbn_siri_et_calls_licence CHECK ((source_id = 'vbn_siri_et'::text)),
    CONSTRAINT vbn_siri_et_calls_visit CHECK ((visit >= 1))
)
PARTITION BY RANGE (observed_at);

CREATE VIEW public.vbn_transit_delays AS
 SELECT observed_at,
    feed_ts,
    (((service_day)::text || ':'::text) || journey_ref) AS trip_id,
    stop_ref AS stop_id,
    delay_s,
        CASE
            WHEN cancelled THEN 'SKIPPED'::text
            ELSE 'SCHEDULED'::text
        END AS schedule_relationship,
    source_id AS source
   FROM public.vbn_siri_et_calls c;

CREATE VIEW public.vbn_transit_delays_live AS
 SELECT observed_at,
    feed_ts,
    trip_id,
    stop_id,
    delay_s,
    schedule_relationship,
    source
   FROM public.vbn_transit_delays d
  WHERE (observed_at >= (now() - '03:00:00'::interval));

CREATE TABLE public.vrn_transit_delays (
    observed_at timestamp with time zone NOT NULL,
    feed_ts timestamp with time zone NOT NULL,
    trip_id text NOT NULL,
    stop_id text,
    stop_sequence integer,
    delay_s integer,
    schedule_relationship text DEFAULT 'SCHEDULED'::text NOT NULL,
    source text DEFAULT 'vrn_rt'::text NOT NULL,
    raw jsonb,
    source_run_id bigint,
    CONSTRAINT vrn_transit_delays_licence CHECK ((source = 'vrn_rt'::text))
)
PARTITION BY RANGE (observed_at);

CREATE VIEW public.vrn_transit_delays_live AS
 SELECT observed_at,
    feed_ts,
    trip_id,
    stop_id,
    delay_s,
    schedule_relationship,
    source
   FROM public.vrn_transit_delays d
  WHERE (observed_at >= (now() - '03:00:00'::interval));

CREATE TABLE public.watch_events (
    id bigint NOT NULL,
    watch_id bigint NOT NULL,
    summary text NOT NULL,
    as_of timestamp with time zone NOT NULL,
    source_ids text[] DEFAULT '{}'::text[] NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    revision integer DEFAULT 1 NOT NULL,
    CONSTRAINT watch_events_revision_positive CHECK ((revision >= 1)),
    CONSTRAINT watch_events_summary_bounded CHECK (((length(summary) >= 1) AND (length(summary) <= 2000))),
    CONSTRAINT watch_events_updated_not_before_created CHECK ((updated_at >= created_at))
);

ALTER TABLE public.watch_events ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.watch_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.watches (
    id bigint NOT NULL,
    session_id text NOT NULL,
    kind text NOT NULL,
    key text NOT NULL,
    condition jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    stopped_at timestamp with time zone,
    CONSTRAINT watches_condition_is_object CHECK (((condition IS NULL) OR (jsonb_typeof(condition) = 'object'::text))),
    CONSTRAINT watches_key_bounded CHECK (((length(key) >= 1) AND (length(key) <= 200))),
    CONSTRAINT watches_kind_known CHECK ((kind = ANY (ARRAY['road'::text, 'station'::text, 'region'::text, 'place'::text, 'weather'::text, 'charger'::text]))),
    CONSTRAINT watches_session_bounded CHECK (((length(session_id) >= 1) AND (length(session_id) <= 200))),
    CONSTRAINT watches_window_24h CHECK (((expires_at > created_at) AND (expires_at <= (created_at + '24:00:00'::interval))))
);

ALTER TABLE public.watches ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.watches_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.weather_warnings (
    id bigint NOT NULL,
    source_feed text NOT NULL,
    source_id text NOT NULL,
    identifier text NOT NULL,
    warncell_id text NOT NULL,
    version integer NOT NULL,
    area_desc text,
    event text,
    level smallint NOT NULL,
    level_source text,
    severity text,
    urgency text,
    certainty text,
    headline text,
    description text,
    instruction text,
    official_sha256 text NOT NULL,
    valid_from timestamp with time zone NOT NULL,
    valid_to timestamp with time zone,
    published_at timestamp with time zone,
    area public.geography(MultiPolygon,4326),
    area_sha256 text NOT NULL,
    raw jsonb NOT NULL,
    source_publisher text,
    source_run_id bigint,
    provider_updated_at timestamp with time zone,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    closed_at timestamp with time zone,
    closed_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    deleted_reason text,
    deleted_run_id bigint,
    CONSTRAINT weather_warnings_area_hash CHECK ((area_sha256 ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT weather_warnings_attribution CHECK (((source_id <> ''::text) AND (source_id !~~ '%\_pending'::text))),
    CONSTRAINT weather_warnings_closed_reason CHECK (((closed_at IS NULL) OR (closed_reason = ANY (ARRAY['withdrawn'::text, 'superseded'::text])))),
    CONSTRAINT weather_warnings_hash CHECK ((official_sha256 ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT weather_warnings_level CHECK (((level >= 0) AND (level <= 4))),
    CONSTRAINT weather_warnings_level_source CHECK (((level_source IS NULL) OR (level_source = ANY (ARRAY['published'::text, 'derived_from_severity'::text])))),
    CONSTRAINT weather_warnings_window CHECK (((valid_to IS NULL) OR (valid_to >= valid_from)))
);

CREATE VIEW public.weather_warnings_live AS
 SELECT id,
    source_feed,
    source_id,
    identifier,
    warncell_id,
    version,
    area_desc,
    event,
    level,
    level_source,
    severity,
    urgency,
    certainty,
    headline,
    description,
    instruction,
    official_sha256,
    valid_from,
    valid_to,
    published_at,
    area,
    area_sha256,
    raw,
    source_publisher,
    source_run_id,
    provider_updated_at,
    first_seen_at,
    last_seen_at,
    closed_at,
    closed_reason,
    created_at,
    updated_at,
    deleted_at,
    deleted_reason,
    deleted_run_id
   FROM public.weather_warnings
  WHERE (deleted_at IS NULL);

CREATE VIEW public.weather_warnings_area_live AS
 SELECT w.identifier,
    w.warncell_id,
    w.event,
    w.level,
    w.level_source,
    w.headline,
    w.valid_from,
    w.valid_to,
    w.area,
    w.source_id,
    w.closed_at,
    w.description,
    w.instruction,
    en.en_headline,
    en.en_description,
    en.en_instruction,
    en.en_sha256 AS en_content_sha256
   FROM (public.weather_warnings_live w
     LEFT JOIN LATERAL public.weather_warning_english(w.id) en(en_headline, en_description, en_instruction, en_sha256) ON (true));

CREATE TABLE public.weather_warnings_en (
    id bigint NOT NULL,
    source_feed text NOT NULL,
    source_id text NOT NULL,
    identifier text NOT NULL,
    base_identifier text NOT NULL,
    msg_type text,
    language text NOT NULL,
    event text,
    event_code smallint,
    headline text,
    description text,
    instruction text,
    content_sha256 text NOT NULL,
    sent_at timestamp with time zone,
    valid_from timestamp with time zone,
    valid_to timestamp with time zone,
    warncell_ids text[] DEFAULT '{}'::text[] NOT NULL,
    raw jsonb NOT NULL,
    source_publisher text,
    source_run_id bigint,
    provider_updated_at timestamp with time zone,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    closed_at timestamp with time zone,
    closed_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT weather_warnings_en_attribution CHECK (((source_id <> ''::text) AND (source_id !~~ '%\_pending'::text))),
    CONSTRAINT weather_warnings_en_closed_reason CHECK (((closed_at IS NULL) OR (closed_reason = ANY (ARRAY['withdrawn'::text, 'superseded'::text])))),
    CONSTRAINT weather_warnings_en_hash CHECK ((content_sha256 ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT weather_warnings_en_window CHECK (((valid_to IS NULL) OR (valid_from IS NULL) OR (valid_to >= valid_from)))
);

ALTER TABLE public.weather_warnings_en ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.weather_warnings_en_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE VIEW public.weather_warnings_en_live AS
 SELECT base_identifier,
    identifier,
    language,
    event,
    headline,
    description,
    instruction,
    content_sha256,
    sent_at,
    valid_from,
    valid_to,
    warncell_ids,
    ((raw -> 'eventCodes'::text) ->> 'II'::text) AS event_ii
   FROM public.weather_warnings_en e
  WHERE (closed_at IS NULL);

ALTER TABLE public.weather_warnings ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.weather_warnings_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.worker_boots (
    id bigint NOT NULL,
    worker text NOT NULL,
    worker_version text NOT NULL,
    git_sha text,
    hostname text,
    node_version text,
    booted_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    config jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT worker_boots_config_holds_no_subscription_id CHECK (((config)::text !~ '[0-9]{19}'::text)),
    CONSTRAINT worker_boots_config_is_an_object CHECK ((jsonb_typeof(config) = 'object'::text)),
    CONSTRAINT worker_boots_config_is_flat CHECK ((NOT jsonb_path_exists(config, '$.*?(@.type() == "object" || @.type() == "array")'::jsonpath))),
    CONSTRAINT worker_boots_worker_is_a_name CHECK ((worker ~ '^[a-z][a-z0-9-]*$'::text))
);

ALTER TABLE public.worker_boots ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.worker_boots_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

ALTER TABLE ONLY public.city_traffic_segments ALTER COLUMN id SET DEFAULT nextval('public.city_traffic_segments_id_seq'::regclass);

ALTER TABLE ONLY public.hydrogen_stations ALTER COLUMN id SET DEFAULT nextval('public.hydrogen_stations_id_seq'::regclass);

ALTER TABLE ONLY public.parking_facilities ALTER COLUMN id SET DEFAULT nextval('public.parking_facilities_id_seq'::regclass);

ALTER TABLE ONLY public.parking_facilities_bysa ALTER COLUMN id SET DEFAULT nextval('public.parking_facilities_bysa_id_seq'::regclass);

ALTER TABLE ONLY public.parking_facilities_odbl ALTER COLUMN id SET DEFAULT nextval('public.parking_facilities_odbl_id_seq'::regclass);

ALTER TABLE ONLY public.partition_archives ALTER COLUMN id SET DEFAULT nextval('public.partition_archives_id_seq'::regclass);

ALTER TABLE ONLY public.speed_enforcement ALTER COLUMN id SET DEFAULT nextval('public.speed_enforcement_id_seq'::regclass);

ALTER TABLE ONLY public.traffic_count_sites ALTER COLUMN id SET DEFAULT nextval('public.traffic_count_sites_id_seq'::regclass);

COPY control.budget_state (budget_key, last_admitted_at, last_admitted_by, person_wanted_at, held_until, held_reason, owed_by, owed_at) FROM stdin;
\.

COPY control.budgets (budget_key, window_s, licence_max, licence_source, ceiling, burst_window_s, burst_licence_max, burst_max, spacing_licence_ms, spacing_ms, hold_s, reserve_pct) FROM stdin;
\.

COPY control.callers (caller, process, person, purpose) FROM stdin;
\.

COPY control.changes (id, at, actor, reason, tbl, budget_key, caller, field, before, after) FROM stdin;
\.

COPY control.feed_state (ledger, key, budget_key, cadence_s, next_due_at, last_attempt_at, last_attempt_status, last_success_at, last_changed_at, last_refusal_at, last_refusal, refused_since, updated_at) FROM stdin;
\.

COPY control.providers (provider, budget_key, min_interval_ms, max_concurrent) FROM stdin;
\.

COPY control.refusals (id, at, budget_key, provider, caller, subject, outcome, wait_ms) FROM stdin;
\.

COPY control.shares (budget_key, caller, floor, cap) FROM stdin;
\.

COPY control.usage (budget_key, caller, bucket_start, admitted, not_sent) FROM stdin;
\.

COPY control.usage_hourly (hour, budget_key, caller, admitted, not_sent, refused_ceiling, refused_share, refused_reserved, refused_burst, refused_spacing, refused_yield, refused_hold, refused_unconfigured, first_refused_at, last_refused_at, ceiling_at, cap_at, floor_at, computed_at) FROM stdin;
\.

COPY domains.road_works (id, source_id, feed, external_id, match_key, observed_at, first_seen_at, updated_at, closed_at, geom, extras, title, description, street, municipality, starts_at, ends_at, restriction) FROM stdin;
\.

COPY domains.route_recommendations (id, source_id, feed, external_id, match_key, observed_at, first_seen_at, updated_at, closed_at, geom, extras, situation_id, situation_version, record_type, management_type, recommendation, comment, route, signed, severity, validity_status, starts_at, ends_at, confidentiality, published_at) FROM stdin;
\.

COPY domains.speed_cameras (id, source_id, feed, external_id, match_key, observed_at, first_seen_at, updated_at, closed_at, geom, extras, kind, speed_limit, street, municipality, valid_from, valid_to, cases) FROM stdin;
\.

COPY domains.transit_agencies_odbl (id, source_id, feed, external_id, match_key, observed_at, first_seen_at, updated_at, closed_at, extras, agency_name, agency_url, agency_timezone, agency_lang, feed_version) FROM stdin;
\.

COPY domains.transit_routes_odbl (id, source_id, feed, external_id, match_key, observed_at, first_seen_at, updated_at, closed_at, extras, agency_id, route_short_name, route_long_name, route_type, route_color, route_text_color, feed_version) FROM stdin;
\.

COPY domains.transit_service_dates_odbl (id, source_id, feed, external_id, match_key, observed_at, first_seen_at, updated_at, closed_at, extras, service_id, service_date, feed_version) FROM stdin;
\.

COPY domains.transit_stop_times_odbl (id, source_id, feed, external_id, match_key, observed_at, first_seen_at, updated_at, closed_at, extras, trip_id, stop_sequence, stop_id, arrival_s, departure_s, stop_headsign, pickup_type, drop_off_type, timepoint, feed_version) FROM stdin;
\.

COPY domains.transit_stops_odbl (id, source_id, feed, external_id, match_key, observed_at, first_seen_at, updated_at, closed_at, geom, extras, stop_name, stop_code, location_type, parent_station, stop_timezone, platform_code, wheelchair_boarding, feed_version) FROM stdin;
\.

COPY domains.transit_trip_updates_odbl (id, source_id, feed, external_id, match_key, observed_at, first_seen_at, updated_at, closed_at, extras, entity_id, trip_id, route_id, start_date, start_time, direction_id, trip_relationship, vehicle_id, trip_delay_s, stop_sequence, stop_id, stop_relationship, arrival_delay_s, arrival_at, departure_delay_s, departure_at) FROM stdin;
\.

COPY domains.transit_trips_odbl (id, source_id, feed, external_id, match_key, observed_at, first_seen_at, updated_at, closed_at, extras, route_id, service_id, trip_headsign, trip_short_name, direction_id, shape_id, wheelchair_accessible, bikes_allowed, feed_version) FROM stdin;
\.

COPY ingestor.limit_claims (limit_key, min_interval_ms, per_hour, per_day, last_start_at, starts, claims_total) FROM stdin;
\.

COPY ingestor.run_errors (id, run_id, source_id, at, stage, field, reason, sample) FROM stdin;
\.

COPY ingestor.runs (id, source_id, unit, pod, config_sha256, scheduled_at, started_at, finished_at, duration_ms, status, fetched, parsed, inserted, updated, closed, rejected, requests, bytes, http_status, error_class, error_stage, error_message, error_stack, attempt, mem_peak_bytes, raw_path, projected_at) FROM stdin;
\.

COPY ingestor.source_state (source_id, last_run_id, last_status, last_success_at, last_error_at, last_error_class, consecutive_failures, next_due_at, etag, last_modified, cursor, limit_usage, updated_at) FROM stdin;
\.

COPY ingestor.sources (id, name, domain, feed, provider, unit, config_version, config_sha256, status, publisher, country, added_in, licence_id, licence_url, attribution, trust, schedule, limits, issue, created_at, updated_at, registered_by) FROM stdin;
\.

COPY ingestor.units (name, mode, members, config_sha256, image, git_sha, first_deployed_at, last_deployed_at, last_seen_at, last_pod) FROM stdin;
\.

COPY public.ags_regions (ags, level, name, name_norm, name_en, name_en_norm, parent_ags, geom, source_id, first_seen_at, refreshed_at) FROM stdin;
01	land	Schleswig-Holstein	schleswig holstein	Schleswig-Holstein	schleswig holstein	\N	\N	destatis_gv	2026-11-13 21:52:32.806494+00	2026-11-13 21:52:32.806494+00
02	land	Hamburg	hamburg	Hamburg	hamburg	\N	\N	destatis_gv	2026-11-13 21:52:32.806494+00	2026-11-13 21:52:32.806494+00
03	land	Niedersachsen	niedersachsen	Lower Saxony	lower saxony	\N	\N	destatis_gv	2026-11-13 21:52:32.806494+00	2026-11-13 21:52:32.806494+00
04	land	Bremen	bremen	Bremen	bremen	\N	\N	destatis_gv	2026-11-13 21:52:32.806494+00	2026-11-13 21:52:32.806494+00
05	land	Nordrhein-Westfalen	nordrhein westfalen	North Rhine-Westphalia	north rhine westphalia	\N	\N	destatis_gv	2026-11-13 21:52:32.806494+00	2026-11-13 21:52:32.806494+00
06	land	Hessen	hessen	Hesse	hesse	\N	\N	destatis_gv	2026-11-13 21:52:32.806494+00	2026-11-13 21:52:32.806494+00
07	land	Rheinland-Pfalz	rheinland pfalz	Rhineland-Palatinate	rhineland palatinate	\N	\N	destatis_gv	2026-11-13 21:52:32.806494+00	2026-11-13 21:52:32.806494+00
08	land	Baden-Württemberg	baden wurttemberg	Baden-Württemberg	baden wurttemberg	\N	\N	destatis_gv	2026-11-13 21:52:32.806494+00	2026-11-13 21:52:32.806494+00
09	land	Bayern	bayern	Bavaria	bavaria	\N	\N	destatis_gv	2026-11-13 21:52:32.806494+00	2026-11-13 21:52:32.806494+00
10	land	Saarland	saarland	Saarland	saarland	\N	\N	destatis_gv	2026-11-13 21:52:32.806494+00	2026-11-13 21:52:32.806494+00
11	land	Berlin	berlin	Berlin	berlin	\N	\N	destatis_gv	2026-11-13 21:52:32.806494+00	2026-11-13 21:52:32.806494+00
12	land	Brandenburg	brandenburg	Brandenburg	brandenburg	\N	\N	destatis_gv	2026-11-13 21:52:32.806494+00	2026-11-13 21:52:32.806494+00
13	land	Mecklenburg-Vorpommern	mecklenburg vorpommern	Mecklenburg-Western Pomerania	mecklenburg western pomerania	\N	\N	destatis_gv	2026-11-13 21:52:32.806494+00	2026-11-13 21:52:32.806494+00
14	land	Sachsen	sachsen	Saxony	saxony	\N	\N	destatis_gv	2026-11-13 21:52:32.806494+00	2026-11-13 21:52:32.806494+00
15	land	Sachsen-Anhalt	sachsen anhalt	Saxony-Anhalt	saxony anhalt	\N	\N	destatis_gv	2026-11-13 21:52:32.806494+00	2026-11-13 21:52:32.806494+00
16	land	Thüringen	thuringen	Thuringia	thuringia	\N	\N	destatis_gv	2026-11-13 21:52:32.806494+00	2026-11-13 21:52:32.806494+00
\.

COPY public.alarm_episodes (id, feed_key, kind, opened_at, last_seen_at, cleared_at, detail) FROM stdin;
\.

COPY public.autobahn_event_texts (road, title, subtitle, first_seen_at, last_seen_at, geom) FROM stdin;
\.

COPY public.autobahn_jam_hours (hour_start, road, jam_titles, jam_subtitles) FROM stdin;
\.

COPY public.autobahn_roads (road, first_seen_at, last_seen_at, last_listed_at) FROM stdin;
\.

COPY public.bfrk_stops (source_feed, source_publisher, dhid, name, municipality, geom, validated, collected_by, platforms, platforms_height_known, platform_height_min_cm, platform_height_max_cm, platforms_guidance, lifts, lift_door_min_cm, lift_cabin_min_width_cm, lift_cabin_min_length_cm, ramps, ramp_max_slope_pct, stairs, escalators, first_seen_at, last_seen_at, closed_at, provider_updated_at, source_run_id, created_at, updated_at, platforms_level_boarding, platforms_ramp_boarding, platforms_limited_boarding, platforms_no_step_free, step_free, publisher_note, stop_ref, entrances, entrances_lift) FROM stdin;
\.

COPY public.bw_detours (id, version_date, source_url, sheet_row, autobahn, autobahn_raw, direction, extra, u_number, from_junction_no, from_junction, to_junction_no, to_junction, route, raw, first_seen_at, last_seen_at, closed_at, source_feed, source_publisher, source_run_id, provider_updated_at, created_at, updated_at) FROM stdin;
\.

COPY public.charging_points (source_feed, point_key, evse_id, point_key_synthetic, site_id, station_id, provider_point_id, operator, geom, connector_types, current_type, max_power_kw, price_per_kwh, price_tax_included, price_tax_rate, price_currency, price_last_updated, source_version, first_seen_at, last_seen_at, closed_at, source_publisher, source_run_id, provider_updated_at, created_at, updated_at, deleted_at, deleted_reason, deleted_run_id, confidentiality, extras, price_adhoc_zero) FROM stdin;
\.

COPY public.charging_sites (source_feed, site_id, source_version, name, operator, operator_id, street, house_number, postcode, city, country_code, geom, first_seen_at, last_seen_at, closed_at, source_publisher, source_run_id, provider_updated_at, created_at, updated_at, deleted_at, deleted_reason, deleted_run_id, road, point_count, confidentiality) FROM stdin;
\.

COPY public.charging_status_runs (observed_at, source_feed, source_run_id, is_delta, stated_at, ticks) FROM stdin;
\.

COPY public.city_traffic_pulls (feed_key, observed_at, measured_at, segments, listing, source_run_id, updated_at) FROM stdin;
\.

COPY public.city_traffic_segments (id, segment_key, ext_id, road_class, geom, first_seen_at, last_seen_at, source_feed, source_publisher, source_run_id, provider_updated_at, created_at, updated_at) FROM stdin;
\.

COPY public.city_traffic_state (segment_id, status, level, speed_kmh, extras, status_since, last_seen_at, source_feed, source_publisher, source_run_id, provider_updated_at, created_at, updated_at) FROM stdin;
\.

COPY public.db_facilities (equipment_no, station_no, kind, state, state_explanation, description, operator, resume_at, lon, lat, extras, state_since, first_seen_at, last_seen_at, source_feed, source_publisher, source_run_id, provider_updated_at, created_at, updated_at) FROM stdin;
\.

COPY public.db_station_boards (station_no, eva_nos, read_at, degraded, covers_until, departures, source_feed, source_publisher, source_run_id, provider_updated_at, created_at, updated_at) FROM stdin;
\.

COPY public.db_station_numbers (eva_no, station_no, name, source_id, first_seen_at, last_seen_at, part_eva_nos, category, municipality_code) FROM stdin;
\.

COPY public.db_stations (station_no, name, eva_no, eva_nos, ds100, ifopt, category, price_category, federal_state, municipality_code, street, zipcode, city, geom, stepless_access, has_parking, has_bicycle_parking, has_local_public_transport, has_public_facilities, has_locker_system, has_taxi_rank, has_travel_necessities, has_wifi, has_travel_center, has_railway_mission, has_db_lounge, has_lost_and_found, has_car_rental, mobility_service, mobility_staff, db_information, local_service_staff, service_phone, source_id, content_hash, first_seen_at, last_seen_at, updated_at, closed_at) FROM stdin;
\.

COPY public.delfi_service_alerts (id, source_id, source_feed, alert_id, header, description, cause, effect, url, active_from, active_to, active_periods, route_ids, line_names, stop_ids, kreise, lands, placed_by, dedupe_key, message_ref, content_hash, confidentiality, first_seen_at, last_seen_at, closed_at, source_publisher, source_run_id, provider_updated_at, created_at, updated_at) FROM stdin;
\.

COPY public.delfi_siri_et_calls_latest (stop_ref, service_day, journey_ref, visit, source_feed, observed_at, line, category, destination, platform, aimed_dep, expected_dep, delay_s, recorded, cancelled, journey_cancelled) FROM stdin;
\.

COPY public.delfi_siri_et_stop_pairs (eva, dhid, station_dhid, matches, first_seen_at, confirmed_at, source_id) FROM stdin;
\.

COPY public.deployments (id, deployed_at, version, git_sha, git_ref, previous_git_sha, migration_head, image_built_at, deploy_duration_s, note, app_digest, translator_digest) FROM stdin;
\.

COPY public.energy_page_key_heads (kind, generation, total, feed_counts, content_md5, built_at, checked_at, build_ms) FROM stdin;
\.

COPY public.energy_page_keys (kind, generation, ord, source_feed, item_id, brand_operator, name, street, city, day, slug) FROM stdin;
\.

COPY public.energy_page_slug_history (kind, slug, source_feed, item_id, retired_at) FROM stdin;
\.

COPY public.energy_page_slugs (kind, source_feed, item_id, slug, assigned_at) FROM stdin;
\.

COPY public.error_events (hour, line_sha, service, container, level, kind, key, status, ms, provider, sqlstate, err_class, message, stack_sha, stack_sample, first_at, last_at, count) FROM stdin;
\.

COPY public.feed_catalog (feed_key, provider, display_name, offer_id, offer_url, licence_id, licence_label, attribution, subscription_var, format, profile, cadence_s, min_interval_s, enabled, registry_version, updated_at, closed_at, published_by, declared_cadence_s, listed_at) FROM stdin;
\.

COPY public.feed_run_extents (feed_key, max_items, max_started_at, computed_at, version) FROM stdin;
\.

COPY public.feed_runs (id, feed_key, started_at, finished_at, status, http_status, bytes, etag, last_modified, raw_path, items_seen, items_changed, error, wire_bytes, duration_ms, body_sha256, items_inserted, items_updated, items_closed, note, worker_version, next_due_at, reader_epoch, jumped, exchange_protocol, budget_hit) FROM stdin;
\.

COPY public.feed_versions (ledger, key, version, observed_at) FROM stdin;
\.

COPY public.feeds (id, provider, feed_version, fetched_at, active, extras, source_feed, source_publisher, source_run_id, provider_updated_at, created_at, updated_at, gtfs_feed_key) FROM stdin;
1	delfi_static	delfi-stable	2026-11-13 21:52:35.09114+00	f	{"note": "release id, validity and the last load's counts are written here by the timetable loader"}	delfi_static	DELFI e.V.	\N	\N	2026-11-13 21:52:35.09114+00	2026-11-13 21:52:35.09114+00	1
2	connect_static	connect-stable	2026-11-13 21:52:48.828204+00	f	{"note": "VBN Connect (Niedersachsen und Bremen), CC BY 4.0, loaded from the publisher's current release; release fingerprint and the last load's counts are written here by the loader"}	mobilithek_connect_gtfs	Verkehrsverbund Bremen/Niedersachsen GmbH (VBN)	\N	\N	2026-11-13 21:52:48.828204+00	2026-11-13 21:52:48.828204+00	2
\.

COPY public.fuel_city_seed (ags, name, radius_km, last_attempt_at, last_ok_at, stations, source_run_id, last_error) FROM stdin;
\.

COPY public.fuel_price_latest (station_id, product, price, is_open, observed_at, source_feed, source_publisher, source_run_id, provider_updated_at, created_at, updated_at, deleted_at, deleted_reason, deleted_run_id) FROM stdin;
\.

COPY public.fuel_products (code, label, unit, mtsk, active) FROM stdin;
e5	Super E5	EUR/l	t	t
e10	Super E10	EUR/l	t	t
diesel	Diesel	EUR/l	t	t
\.

COPY public.fuel_sample_draws (id, drawn_at, design_version, rng_seed, interval_s, capacity, target_total, drawn_total, core_share, land_floor, history_days, history_basis, brand_basis, notes) FROM stdin;
\.

COPY public.fuel_sample_strata (draw_id, stratum, land_ags, settlement_class, brand_class, held, target, achieved, core, rotating) FROM stdin;
\.

COPY public.fuel_station_watch (station_id, tier, refresh_interval_s, reason, priority, active, added_at, last_polled_at, last_error, consecutive_errors, asked_at, detail_errors, detail_attempted_at, sample_draw_id, sample_stratum, sample_role, city_tier, city_ags) FROM stdin;
\.

COPY public.fuel_stations (id, brand, name, street, house_no, postcode, city, geom, source, updated_at, opening_times, whole_day, state, first_seen_at, last_seen_at, detail_refreshed_at, overrides, source_feed, source_publisher, source_run_id, provider_updated_at, created_at, deleted_at, deleted_reason, deleted_run_id, land, town_places) FROM stdin;
\.

COPY public.gazetteer_places (id, kind, name, name_norm, name_en, admin_code, population, geom, road, source_id, external_id, rank, first_seen_at, last_seen_at, closed_at, part_of, part_type) FROM stdin;
\.

COPY public.gbfs_stations (system_id, station_id, name, capacity, is_virtual, geom, first_seen_at, last_seen_at, closed_at, source_feed, source_publisher, source_run_id, provider_updated_at, created_at, updated_at) FROM stdin;
\.

COPY public.gbfs_systems (system_id, publisher, name, operator, gbfs_version, license_id, admitted, refused_reason, licence_read_at, ttl_s, status_seen_at, vehicles_seen_at, first_seen_at, last_seen_at, source_feed, source_publisher, source_run_id, provider_updated_at, created_at, updated_at, licence_basis) FROM stdin;
\.

COPY public.gbfs_vehicles (system_id, seq, form_factor, propulsion, range_m, geom, observed_at, source_feed, source_publisher, source_run_id, provider_updated_at, created_at, updated_at) FROM stdin;
\.

COPY public.growth_weekly (week, computed_at, complete, search_state, search_impressions, search_clicks, search_position, site_state, site_days, people_views, own_views, crawler_views, automation_views, home_views, connect_views, mcp_state, mcp_initialize_ext, mcp_calls_ext, mcp_errors_ext, mcp_clients_ext, mcp_calls_own, directory_listings) FROM stdin;
\.

COPY public.gtfs_service_dates (service_date, gtfs_feed_key, service_id) FROM stdin;
\.

COPY public.gtfs_stale_trips (gtfs_feed_key, trip_id, retired_run_id, retired_at) FROM stdin;
\.

COPY public.hh_cameras (camera_id, location_label, note, geom, first_seen_at, last_seen_at, closed_at, source_feed, source_publisher, source_run_id, provider_updated_at, created_at, updated_at) FROM stdin;
\.

COPY public.hh_roadwork_versions (site_id, content_hash, observed_at, provider_updated_at, released, starts_on, ends_on, props, geom, source_run_id) FROM stdin;
\.

COPY public.hh_roadworks (site_id, title, organisation, cause, scope, starts_on, ends_on, released, hotspot, link, props, geom, content_hash, first_seen_at, last_seen_at, closed_at, source_feed, source_publisher, source_run_id, provider_updated_at, created_at, updated_at) FROM stdin;
\.

COPY public.host_samples (sampled_at, disk_total_b, disk_used_b, disk_avail_b, mem_total_b, mem_available_b, db_size_b, containers) FROM stdin;
\.

COPY public.hydrogen_stations (id, source_feed, external_id, name, operator, brand, geom, address, refill, opening, attribution_id, first_seen_at, last_seen_at, closed_at, source_publisher, source_run_id, provider_updated_at, created_at, updated_at) FROM stdin;
\.

COPY public.ingest_runs (id, provider, started_at, finished_at, status, rows, bytes, error, skipped_targets, body_sha256, duration_ms, note, next_due_at, worker_version, budget_hit) FROM stdin;
\.

COPY public.landing_collect_cursor (stream, signature, byte_offset, collected_at) FROM stdin;
\.

COPY public.landing_error_hourly (hour, kind, zone, n) FROM stdin;
\.

COPY public.landing_reloads (at, service, action, result) FROM stdin;
\.

COPY public.landing_status_hourly (hour, route_class, agent_class, status, n) FROM stdin;
\.

COPY public.lez_zone_overlaps (source_feed, zone_id, other_feed, other_zone_id, shared_area, smaller_area, computed_at) FROM stdin;
\.

COPY public.lez_zone_versions (source_feed, zone_id, content_hash, observed_at, role, name, props, geom, source_run_id) FROM stdin;
\.

COPY public.lez_zones (source_feed, source_publisher, zone_id, role, name, props, geom, content_hash, first_seen_at, last_seen_at, closed_at, source_run_id, provider_updated_at, created_at, updated_at, place_name) FROM stdin;
\.

COPY public.lorry_city (id, source_feed, feature_key, layer, publisher_id, group_id, road, road_raw, land, street, municipality, district, kind, sign, value, unit, published_text, exceptions, times, days, one_way, category, direction, length_m, network_state, ordinance, version_date, geom, raw, first_seen_at, closed_at, source_publisher, source_run_id, provider_updated_at, created_at, updated_at) FROM stdin;
\.

COPY public.lorry_hb (id, source_feed, feature_key, layer, publisher_id, group_id, road, road_raw, land, street, municipality, district, kind, sign, value, unit, published_text, exceptions, times, days, one_way, category, direction, length_m, network_state, ordinance, version_date, geom, raw, first_seen_at, closed_at, source_publisher, source_run_id, provider_updated_at, created_at, updated_at) FROM stdin;
\.

COPY public.lorry_ivm (id, source_feed, feature_key, layer, publisher_id, group_id, road, road_raw, land, street, municipality, district, kind, sign, value, unit, published_text, exceptions, times, days, one_way, category, direction, length_m, network_state, ordinance, version_date, geom, raw, first_seen_at, closed_at, source_publisher, source_run_id, provider_updated_at, created_at, updated_at) FROM stdin;
\.

COPY public.lorry_long_network (id, source_feed, feature_key, layer, publisher_id, group_id, road, road_raw, land, street, municipality, district, kind, sign, value, unit, published_text, exceptions, times, days, one_way, category, direction, length_m, network_state, ordinance, version_date, geom, raw, first_seen_at, closed_at, source_publisher, source_run_id, provider_updated_at, created_at, updated_at) FROM stdin;
\.

COPY public.lorry_sevas (id, source_feed, feature_key, layer, publisher_id, group_id, road, road_raw, land, street, municipality, district, kind, sign, value, unit, published_text, exceptions, times, days, one_way, category, direction, length_m, network_state, ordinance, version_date, geom, raw, first_seen_at, closed_at, source_publisher, source_run_id, provider_updated_at, created_at, updated_at) FROM stdin;
\.

COPY public.los_lane_sites (lane_id, site_id, lane, geom, version, confidentiality, first_seen_at, last_seen_at, closed_at, source_feed, source_publisher, source_run_id, provider_updated_at, created_at, updated_at) FROM stdin;
\.

COPY public.los_lane_state (lane_id, site_id, status, measured_at, status_since, last_seen_at, confidentiality, source_feed, source_publisher, source_run_id, provider_updated_at, created_at, updated_at) FROM stdin;
\.

COPY public.los_sites (site_id, section, carriageway, direction, geom, road, road_rule, version, confidentiality, first_seen_at, last_seen_at, closed_at, source_feed, source_publisher, source_run_id, provider_updated_at, created_at, updated_at) FROM stdin;
\.

COPY public.los_state (site_id, status, measured_at, status_since, last_seen_at, confidentiality, source_feed, source_publisher, source_run_id, provider_updated_at, created_at, updated_at) FROM stdin;
\.

COPY public.mcp_usage (period, period_start, door, rpc, tool, client, requests, errors, sessions, total_ms, ms_le_100, ms_le_250, ms_le_500, ms_le_1000, ms_le_2500, ms_le_5000, ms_le_10000, ms_gt_10000, updated_at, refusals, tool_errors, server_errors, tool_error_invalid_input, tool_error_not_found, tool_error_out_of_coverage, tool_error_unavailable, tool_error_limit_reached, tool_error_timeout, tool_error_internal) FROM stdin;
\.

COPY public.mcp_usage_exports (destination, day, state, attempts, claimed_at, finished_at, http_status, totals, error) FROM stdin;
\.

COPY public.motorway_summary (road, refreshed_at, read_at, tick, closures, jams, warnings, roadworks, by_direction, worst, next_closure, sources, page_listing, page_warnings) FROM stdin;
\.

COPY public.mvv_bus_load (source_feed, source_publisher, day_type, dhid, line, direction, dep_time, load_class, file_rows, release_year, first_seen_at, last_seen_at, closed_at, provider_updated_at, source_run_id, created_at, updated_at) FROM stdin;
\.

COPY public.oom_kills (id, killed_at, victim, constraint_kind, container, process, anon_rss_kb, limit_kb, line_sha256, collected_at) FROM stdin;
\.

COPY public.opendata_roadwork_versions (source_feed, site_id, content_hash, observed_at, provider_updated_at, starts_at, ends_at, props, geom, source_run_id) FROM stdin;
\.

COPY public.opendata_roadworks (source_feed, source_publisher, site_id, kind, title, place_text, detail_text, road_number, organisation, closure, affects_traffic, answerable, starts_at, ends_at, day_precision, period_text, planned_layer, link, props, geom, anchor, content_hash, first_seen_at, last_seen_at, closed_at, source_run_id, provider_updated_at, created_at, updated_at, closure_starts_at, closure_ends_at, closure_window_rule) FROM stdin;
\.

COPY public.ops_audit (id, at, actor, action, target, before, after, result, client_ip) FROM stdin;
\.

COPY public.ops_passkeys (id, credential_id, public_key, sign_count, transports, label, created_at, last_used_at) FROM stdin;
\.

COPY public.ops_requests (id, requested_at, action, target, requested_by, state, handled_at, result) FROM stdin;
\.

COPY public.ops_rollup_daily (day, ledger, key, runs, ok, unchanged, degraded, error, quiet, items_seen, items_inserted, items_updated, items_closed, buckets_with_runs, buckets_with_success, last_success_at, computed_at) FROM stdin;
\.

COPY public.ops_rollup_held (day, kind, approx_rows, computed_at) FROM stdin;
\.

COPY public.ops_rollup_usage (day, tool, class, calls, errors, ms_le_100, ms_le_250, ms_le_500, ms_le_1000, ms_le_2500, ms_le_5000, ms_le_10000, ms_gt_10000, computed_at) FROM stdin;
\.

COPY public.osm_addresses (id, osm_type, osm_id, street, house_number, postcode, place, street_norm, house_number_norm, place_norm, geom, source_id, extract_date, first_seen_at, last_seen_at, closed_at, land) FROM stdin;
\.

COPY public.osm_boundary_de (id, land, osm_id, osm_version, part, geom, source_id, extract_date, loaded_at) FROM stdin;
\.

COPY public.osm_pois (id, osm_type, osm_id, name, name_norm, category, category_value, brand, operator, street, house_number, postcode, place, place_norm, geom, source_id, extract_date, first_seen_at, last_seen_at, closed_at, land, access) FROM stdin;
\.

COPY public.osm_replication_state (land, sequence, sequence_timestamp, applied_at, source, extract_date) FROM stdin;
\.

COPY public.osm_speed_cameras (id, osm_type, osm_id, enforces, geom, max_speed_kmh, direction, name, tags, source_id, land, extract_date, first_seen_at, last_seen_at, closed_at) FROM stdin;
\.

COPY public.osm_streets (id, osm_type, osm_id, cls, geom, geom_lo, source_id, land, extract_date, first_seen_at, last_seen_at, closed_at) FROM stdin;
\.

COPY public.parkapi_stray_latch (feed_key, tripped_at, reason, set_at, cleared_at) FROM stdin;
\.

COPY public.parking_facilities (id, source_feed, external_id, kind, name, operator, road, capacity_total, capacity_truck, capacity_disabled, geom, address, opening, attribution_id, source_version, first_seen_at, last_seen_at, closed_at, source_publisher, source_run_id, provider_updated_at, created_at, updated_at, deleted_at, deleted_reason, deleted_run_id, station_ref, station_name, station_name_norm, confidentiality, facilities, facilities_absent, facilities_extra, facilities_source) FROM stdin;
\.

COPY public.parking_facilities_bysa (id, source_feed, external_id, kind, name, operator, road, capacity_total, capacity_truck, capacity_disabled, geom, address, opening, attribution_id, source_version, first_seen_at, last_seen_at, closed_at, source_publisher, source_run_id, provider_updated_at, created_at, updated_at, confidentiality) FROM stdin;
\.

COPY public.parking_facilities_odbl (id, source_feed, external_id, kind, name, operator, road, capacity_total, capacity_truck, capacity_disabled, geom, address, opening, attribution_id, source_version, first_seen_at, last_seen_at, closed_at, source_publisher, source_run_id, provider_updated_at, created_at, updated_at, confidentiality) FROM stdin;
\.

COPY public.parking_facilities_sid (id, source_feed, external_id, kind, name, capacity_total, capacity_truck, geom, address, attribution_id, source_version, first_seen_at, last_seen_at, closed_at, source_publisher, source_run_id, provider_updated_at, created_at, updated_at, confidentiality, facilities, facilities_absent, facilities_extra, facilities_source) FROM stdin;
\.

COPY public.parking_facility_refusals (source_feed, refusals, refused_at) FROM stdin;
\.

COPY public.parking_forecast_profiles (id, facility_id, facility_name, day_type, band_start, band_end, class, class_raw, valid_from, source_version, attribution_id, raw, first_seen_at, last_seen_at, superseded_at, source_feed, source_publisher, source_run_id, provider_updated_at, created_at, updated_at, deleted_at, deleted_reason, deleted_run_id) FROM stdin;
\.

COPY public.parking_occupancy_odbl (observed_at, facility_id, spaces_free, spaces_total, occupancy_pct, status, feed_ts, source_feed, source_run_id, attribution_id, raw, confidentiality, implausible_fields) FROM stdin;
\.

COPY public.parking_sites (site_id, source_version, name, capacity, geom, first_seen_at, last_seen_at, closed_at, source_feed, source_publisher, source_run_id, provider_updated_at, created_at, updated_at, deleted_at, deleted_reason, deleted_run_id) FROM stdin;
\.

COPY public.partition_archives (id, table_name, day, path, bytes, rows, sha256, dumped_at, dropped_at, restored_at, source_run_id) FROM stdin;
\.

COPY public.partition_settings (singleton, min_daily_tables) FROM stdin;
t	19
\.

COPY public.place_slugs (ags, slug, name, assigned_at) FROM stdin;
\.

COPY public.place_website_checks (url, ok, reason, checked_at) FROM stdin;
\.

COPY public.place_websites (ags, url, source_id, wikidata_id, retrieved_at, checked_at) FROM stdin;
\.

COPY public.provider_key_claims (provider, last_request_at, claimed_by, person_wanted_at) FROM stdin;
tankerkoenig	1970-01-01 00:00:00+00	\N	\N
\.

COPY public.road_context_feature_versions (source_feed, feature_id, content_hash, observed_at, props, geom, source_run_id) FROM stdin;
\.

COPY public.road_context_features (source_feed, source_publisher, feature_id, kind, variant, name, ref, detail_text, answerable, props, geom, anchor, content_hash, first_seen_at, last_seen_at, closed_at, source_run_id, provider_updated_at, created_at, updated_at) FROM stdin;
\.

COPY public.road_event_locations (road_event_id, seq, road_number, referent_from, referent_to, distance_from_m, distance_to_m, geom, source_feed, source_publisher, source_run_id, provider_updated_at, created_at, updated_at, deleted_at, deleted_reason, deleted_run_id) FROM stdin;
\.

COPY public.road_event_record_types (feed_key, record_type, known, first_seen_at, last_seen_at, seen_count) FROM stdin;
\.

COPY public.road_event_twins (twin_id, origin_id, rule, score, linked_at) FROM stdin;
\.

COPY public.road_events (id, feed_key, source_id, publication_id, version, publisher, event_type, road_number, referent_from, referent_to, distance_from_m, distance_to_m, geom, feed_ts, overall_start, overall_end, payload, first_seen_at, last_seen_at, closed_at, source_feed, source_publisher, source_run_id, provider_updated_at, created_at, updated_at, deleted_at, deleted_reason, deleted_run_id, confidentiality, closure_starts_at, closure_ends_at, valid_windows, suspended) FROM stdin;
\.

COPY public.road_weather_forecast (station_id, valid_at, run_at, source_id, source_run_id, tl, tlsta, rrl1c, rrs1c, rr6, wwl6, wws3, rrs3c, r650, rc, ts, td) FROM stdin;
\.

COPY public.road_weather_stations (station_id, source_id, name, segment_type, surface, geom, position_source, height_m, flag_raw, inactive, inactive_raw, raw, source_feed, source_publisher, source_run_id, provider_updated_at, created_at, updated_at, first_seen_at, last_seen_at, closed_at) FROM stdin;
\.

COPY public.routes (deleted_at, deleted_run_id, route_type, gtfs_feed_key, id, agency_id, short_name, long_name, deleted_reason, extras) FROM stdin;
\.

COPY public.runtime_config (key, value, changed_by, changed_at, reason) FROM stdin;
\.

COPY public.search_console_weekly (week, state, read_at, tried_at, impressions, clicks, "position", shown_not_clicked, legacy_impressions) FROM stdin;
\.

COPY public.search_console_weekly_parts (week, dimension, key, rows, impressions, clicks, "position") FROM stdin;
\.

COPY public.site_visits_daily (day, visitors, page_views, complete, computed_at, visits, automated, own_views, crawler_views, rule) FROM stdin;
\.

COPY public.site_visits_devices (day, device, views) FROM stdin;
\.

COPY public.site_visits_entries (day, route, visits) FROM stdin;
\.

COPY public.site_visits_entry_referrers (day, referrer, visits) FROM stdin;
\.

COPY public.site_visits_hourly (day, hour, visits, page_views) FROM stdin;
\.

COPY public.site_visits_pages_per_visit (day, bucket, visits) FROM stdin;
\.

COPY public.site_visits_referrers (day, referrer, views) FROM stdin;
\.

COPY public.site_visits_routes (day, route, lang, views) FROM stdin;
\.

COPY public.site_visits_search_engines (day, engine, visits) FROM stdin;
\.

COPY public.source_hosts (host, started_at, heartbeat_at, app_version, sources) FROM stdin;
\.

COPY public.source_schedule (source_key, host, state, next_due_at, last_started_at, last_finished_at, last_request_at, last_status, last_result, declared_cadence_s, granted_cadence_s, floor_s, grant_reason, running_since, heartbeat_at, lateness_ms, paused_by, paused_at, paused_reason, updated_at) FROM stdin;
\.

COPY public.spatial_ref_sys (srid, auth_name, auth_srid, srtext, proj4text) FROM stdin;
\.

COPY public.speed_enforcement (id, source_feed, source_publisher, external_id, attribution_id, kind, enforces, geom, ags, municipality, street, location_text, direction, max_speed_kmh, max_speed_hgv_kmh, valid_from, valid_to, data_as_of, provider_updated_at, extras, first_seen_at, last_seen_at, closed_at, source_run_id, created_at, updated_at) FROM stdin;
\.

COPY public.station_accessibility (element_id, element_kind, stop_place_id, eva_no, eva_nos, station_name, quay_type, quay_name, plate_code, parent_quay_id, platform_height_raw, platform_height_cm, has_assessment, mobility_impaired_access, step_free_access, wheelchair_access, lift_free_access, escalator_free_access, stair_free_access, ramp_free_access, tactile_guidance, audible_signals, visual_signs, guide_dog_access, level_access_into_vehicle, extras, first_seen_at, last_seen_at, closed_at, source_feed, source_publisher, source_run_id, provider_updated_at, created_at, updated_at) FROM stdin;
\.

COPY public.station_equipment (equipment_id, kind, equipment_no, stop_place_id, eva_no, station_name, description, info_url, wheelchair_passable, extras, first_seen_at, last_seen_at, closed_at, source_feed, source_publisher, source_run_id, provider_updated_at, created_at, updated_at) FROM stdin;
\.

COPY public.station_equipment_state (equipment_id, status, state, status_description, status_since, feed_ts, last_seen_at, known_equipment, source_feed, source_publisher, source_run_id, provider_updated_at, created_at, updated_at) FROM stdin;
\.

COPY public.station_metro_osm (dhid, osm_type, osm_id, kind, metres, extract_date, source_id, matched_at, decisive) FROM stdin;
\.

COPY public.station_slugs (slug, station_no, name, assigned_at) FROM stdin;
\.

COPY public.stop_access_odbl (source_feed, dhid, source_stop_ids, name, geom, quays, quays_rail, quays_height_known, quay_height_min_cm, quay_height_max_cm, quays_high_kerb, quays_tactile, quays_portable_ramp, quays_platform_lift, lifts, lift_cabin_min_width_cm, lift_cabin_min_length_cm, ramps, ramp_max_slope_pct, stairs, escalators, published_at, source_publisher, provider_updated_at, first_seen_at, last_seen_at, closed_at, source_run_id, created_at, updated_at) FROM stdin;
\.

COPY public.stop_times (arrival, departure, deleted_at, deleted_run_id, stop_sequence, gtfs_feed_key, pickup_type, drop_off_type, trip_id, stop_id, deleted_reason) FROM stdin;
\.

COPY public.stops (deleted_at, deleted_run_id, gtfs_feed_key, location_type, id, name, parent_id, platform_code, deleted_reason, geom, extras) FROM stdin;
\.

COPY public.street_bay_state (bay_id, state, message_at, last_seen_at, source_feed, source_publisher, source_run_id, provider_updated_at, created_at, updated_at) FROM stdin;
\.

COPY public.street_bays (bay_id, external_id, kind, publisher_kind, street, house_number, postcode, city, charge_point_operator, geom, last_message_at, first_seen_at, last_seen_at, closed_at, source_feed, source_publisher, source_run_id, provider_updated_at, created_at, updated_at, spaces, reserved_when) FROM stdin;
\.

COPY public.tick_storage_days (table_name, day, bytes, measured_at) FROM stdin;
\.

COPY public.tmc_locations (cid, tabcd, lcd, lcl_version, class, tcd, stcd, junction_no, name, road_number, road_lcd, segment_lcd, neg_off_lcd, pos_off_lcd, geom, loaded_at) FROM stdin;
\.

COPY public.traffic_count_latest (site_id, measure, interval_start, interval_end, vehicles, result_time, observed_at, source_feed, source_publisher, source_run_id, provider_updated_at, created_at, updated_at) FROM stdin;
\.

COPY public.traffic_count_profiles (site_id, month, day_kind, hour, vehicles, heavy, speed_kmh, days, source_feed, source_publisher, source_run_id, provider_updated_at, created_at, updated_at) FROM stdin;
\.

COPY public.traffic_count_sites (id, source_feed, site_key, location_key, section_key, scope, name, direction, geom, vehicles_stream, heavy_stream, extras, first_seen_at, last_seen_at, closed_at, source_publisher, source_run_id, provider_updated_at, created_at, updated_at) FROM stdin;
\.

COPY public.translation_cache (key, lang, model, text, created_at, last_used_at) FROM stdin;
\.

COPY public.trips (deleted_at, deleted_run_id, loaded_run_id, gtfs_feed_key, direction_id, id, route_id, service_id, headsign, shape_id, deleted_reason, stop_times_fp, trip_short_name) FROM stdin;
\.

COPY public.validator_horizon (id, not_before, reason, set_at) FROM stdin;
\.

COPY public.watch_events (id, watch_id, summary, as_of, source_ids, created_at, updated_at, revision) FROM stdin;
\.

COPY public.watches (id, session_id, kind, key, condition, created_at, expires_at, stopped_at) FROM stdin;
\.

COPY public.weather_warnings (id, source_feed, source_id, identifier, warncell_id, version, area_desc, event, level, level_source, severity, urgency, certainty, headline, description, instruction, official_sha256, valid_from, valid_to, published_at, area, area_sha256, raw, source_publisher, source_run_id, provider_updated_at, first_seen_at, last_seen_at, closed_at, closed_reason, created_at, updated_at, deleted_at, deleted_reason, deleted_run_id) FROM stdin;
\.

COPY public.weather_warnings_en (id, source_feed, source_id, identifier, base_identifier, msg_type, language, event, event_code, headline, description, instruction, content_sha256, sent_at, valid_from, valid_to, warncell_ids, raw, source_publisher, source_run_id, provider_updated_at, first_seen_at, last_seen_at, closed_at, closed_reason, created_at, updated_at) FROM stdin;
\.

COPY public.worker_boots (id, worker, worker_version, git_sha, hostname, node_version, booted_at, config) FROM stdin;
\.

SELECT pg_catalog.setval('control.changes_id_seq', 1, false);

SELECT pg_catalog.setval('control.refusals_id_seq', 1, false);

SELECT pg_catalog.setval('domains.road_works_id_seq', 1, false);

SELECT pg_catalog.setval('domains.route_recommendations_id_seq', 1, false);

SELECT pg_catalog.setval('domains.speed_cameras_id_seq', 1, false);

SELECT pg_catalog.setval('domains.transit_agencies_odbl_id_seq', 1, false);

SELECT pg_catalog.setval('domains.transit_routes_odbl_id_seq', 1, false);

SELECT pg_catalog.setval('domains.transit_service_dates_odbl_id_seq', 1, false);

SELECT pg_catalog.setval('domains.transit_stop_times_odbl_id_seq', 1, false);

SELECT pg_catalog.setval('domains.transit_stops_odbl_id_seq', 1, false);

SELECT pg_catalog.setval('domains.transit_trip_updates_odbl_id_seq', 1, false);

SELECT pg_catalog.setval('domains.transit_trips_odbl_id_seq', 1, false);

SELECT pg_catalog.setval('ingestor.run_errors_id_seq', 1, false);

SELECT pg_catalog.setval('ingestor.runs_id_seq', 1, false);

SELECT pg_catalog.setval('public.alarm_episodes_id_seq', 1, false);

SELECT pg_catalog.setval('public.bw_detours_id_seq', 1, false);

SELECT pg_catalog.setval('public.city_traffic_segments_id_seq', 1, false);

SELECT pg_catalog.setval('public.delfi_service_alerts_id_seq', 1, false);

SELECT pg_catalog.setval('public.deployments_id_seq', 1, false);

SELECT pg_catalog.setval('public.energy_page_key_generation', 1, false);

SELECT pg_catalog.setval('public.feed_runs_id_seq', 1, false);

SELECT pg_catalog.setval('public.feeds_id_seq', 2, true);

SELECT pg_catalog.setval('public.fuel_sample_draws_id_seq', 1, false);

SELECT pg_catalog.setval('public.gazetteer_places_id_seq', 1, false);

SELECT pg_catalog.setval('public.hydrogen_stations_id_seq', 1, false);

SELECT pg_catalog.setval('public.ingest_runs_id_seq', 1, false);

SELECT pg_catalog.setval('public.lorry_city_id_seq', 1, false);

SELECT pg_catalog.setval('public.lorry_hb_id_seq', 1, false);

SELECT pg_catalog.setval('public.lorry_ivm_id_seq', 1, false);

SELECT pg_catalog.setval('public.lorry_long_network_id_seq', 1, false);

SELECT pg_catalog.setval('public.lorry_sevas_id_seq', 1, false);

SELECT pg_catalog.setval('public.oom_kills_id_seq', 1, false);

SELECT pg_catalog.setval('public.ops_audit_id_seq', 1, false);

SELECT pg_catalog.setval('public.ops_passkeys_id_seq', 1, false);

SELECT pg_catalog.setval('public.ops_requests_id_seq', 1, false);

SELECT pg_catalog.setval('public.osm_addresses_id_seq', 1, false);

SELECT pg_catalog.setval('public.osm_boundary_de_id_seq', 1, false);

SELECT pg_catalog.setval('public.osm_pois_id_seq', 1, false);

SELECT pg_catalog.setval('public.osm_speed_cameras_id_seq', 1, false);

SELECT pg_catalog.setval('public.osm_streets_id_seq', 1, false);

SELECT pg_catalog.setval('public.parking_facilities_bysa_id_seq', 1, false);

SELECT pg_catalog.setval('public.parking_facilities_id_seq', 1, false);

SELECT pg_catalog.setval('public.parking_facilities_odbl_id_seq', 1, false);

SELECT pg_catalog.setval('public.parking_forecast_profiles_id_seq', 1, false);

SELECT pg_catalog.setval('public.partition_archives_id_seq', 1, false);

SELECT pg_catalog.setval('public.road_events_id_seq', 1, false);

SELECT pg_catalog.setval('public.speed_enforcement_id_seq', 1, false);

SELECT pg_catalog.setval('public.traffic_count_sites_id_seq', 1, false);

SELECT pg_catalog.setval('public.watch_events_id_seq', 1, false);

SELECT pg_catalog.setval('public.watches_id_seq', 1, false);

SELECT pg_catalog.setval('public.weather_warnings_en_id_seq', 1, false);

SELECT pg_catalog.setval('public.weather_warnings_id_seq', 1, false);

SELECT pg_catalog.setval('public.worker_boots_id_seq', 1, false);

ALTER TABLE ONLY control.budget_state
    ADD CONSTRAINT budget_state_pkey PRIMARY KEY (budget_key);

ALTER TABLE ONLY control.budgets
    ADD CONSTRAINT budgets_pkey PRIMARY KEY (budget_key);

ALTER TABLE ONLY control.callers
    ADD CONSTRAINT callers_pkey PRIMARY KEY (caller);

ALTER TABLE ONLY control.changes
    ADD CONSTRAINT changes_pkey PRIMARY KEY (id);

ALTER TABLE ONLY control.feed_state
    ADD CONSTRAINT feed_state_pkey PRIMARY KEY (ledger, key);

ALTER TABLE ONLY control.providers
    ADD CONSTRAINT providers_pkey PRIMARY KEY (provider);

ALTER TABLE ONLY control.refusals
    ADD CONSTRAINT refusals_pkey PRIMARY KEY (id);

ALTER TABLE ONLY control.shares
    ADD CONSTRAINT shares_pkey PRIMARY KEY (budget_key, caller);

ALTER TABLE ONLY control.usage_hourly
    ADD CONSTRAINT usage_hourly_pkey PRIMARY KEY (hour, budget_key, caller);

ALTER TABLE ONLY control.usage
    ADD CONSTRAINT usage_pkey PRIMARY KEY (budget_key, bucket_start, caller);

ALTER TABLE ONLY domains.road_works
    ADD CONSTRAINT road_works_owner_key UNIQUE (source_id, feed, external_id);

ALTER TABLE ONLY domains.road_works
    ADD CONSTRAINT road_works_pkey PRIMARY KEY (id);

ALTER TABLE ONLY domains.route_recommendations
    ADD CONSTRAINT route_recommendations_owner_key UNIQUE (source_id, feed, external_id);

ALTER TABLE ONLY domains.route_recommendations
    ADD CONSTRAINT route_recommendations_pkey PRIMARY KEY (id);

ALTER TABLE ONLY domains.speed_cameras
    ADD CONSTRAINT speed_cameras_owner_key UNIQUE (source_id, feed, external_id);

ALTER TABLE ONLY domains.speed_cameras
    ADD CONSTRAINT speed_cameras_pkey PRIMARY KEY (id);

ALTER TABLE ONLY domains.transit_agencies_odbl
    ADD CONSTRAINT transit_agencies_odbl_owner_key UNIQUE (source_id, feed, external_id);

ALTER TABLE ONLY domains.transit_agencies_odbl
    ADD CONSTRAINT transit_agencies_odbl_pkey PRIMARY KEY (id);

ALTER TABLE ONLY domains.transit_routes_odbl
    ADD CONSTRAINT transit_routes_odbl_owner_key UNIQUE (source_id, feed, external_id);

ALTER TABLE ONLY domains.transit_routes_odbl
    ADD CONSTRAINT transit_routes_odbl_pkey PRIMARY KEY (id);

ALTER TABLE ONLY domains.transit_service_dates_odbl
    ADD CONSTRAINT transit_service_dates_odbl_owner_key UNIQUE (source_id, feed, external_id);

ALTER TABLE ONLY domains.transit_service_dates_odbl
    ADD CONSTRAINT transit_service_dates_odbl_pkey PRIMARY KEY (id);

ALTER TABLE ONLY domains.transit_stop_times_odbl
    ADD CONSTRAINT transit_stop_times_odbl_owner_key UNIQUE (source_id, feed, external_id);

ALTER TABLE ONLY domains.transit_stop_times_odbl
    ADD CONSTRAINT transit_stop_times_odbl_pkey PRIMARY KEY (id);

ALTER TABLE ONLY domains.transit_stops_odbl
    ADD CONSTRAINT transit_stops_odbl_owner_key UNIQUE (source_id, feed, external_id);

ALTER TABLE ONLY domains.transit_stops_odbl
    ADD CONSTRAINT transit_stops_odbl_pkey PRIMARY KEY (id);

ALTER TABLE ONLY domains.transit_trip_updates_odbl
    ADD CONSTRAINT transit_trip_updates_odbl_owner_key UNIQUE (source_id, feed, external_id);

ALTER TABLE ONLY domains.transit_trip_updates_odbl
    ADD CONSTRAINT transit_trip_updates_odbl_pkey PRIMARY KEY (id);

ALTER TABLE ONLY domains.transit_trips_odbl
    ADD CONSTRAINT transit_trips_odbl_owner_key UNIQUE (source_id, feed, external_id);

ALTER TABLE ONLY domains.transit_trips_odbl
    ADD CONSTRAINT transit_trips_odbl_pkey PRIMARY KEY (id);

ALTER TABLE ONLY ingestor.limit_claims
    ADD CONSTRAINT limit_claims_pkey PRIMARY KEY (limit_key);

ALTER TABLE ONLY ingestor.run_errors
    ADD CONSTRAINT run_errors_pkey PRIMARY KEY (id);

ALTER TABLE ONLY ingestor.runs
    ADD CONSTRAINT runs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY ingestor.source_state
    ADD CONSTRAINT source_state_pkey PRIMARY KEY (source_id);

ALTER TABLE ONLY ingestor.sources
    ADD CONSTRAINT sources_pkey PRIMARY KEY (id);

ALTER TABLE ONLY ingestor.units
    ADD CONSTRAINT units_pkey PRIMARY KEY (name);

ALTER TABLE ONLY public.ags_regions
    ADD CONSTRAINT ags_regions_pkey PRIMARY KEY (ags);

ALTER TABLE ONLY public.alarm_episodes
    ADD CONSTRAINT alarm_episodes_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.autobahn_event_texts
    ADD CONSTRAINT autobahn_event_texts_pkey PRIMARY KEY (road, title, subtitle);

ALTER TABLE ONLY public.autobahn_jam_hours
    ADD CONSTRAINT autobahn_jam_hours_pkey PRIMARY KEY (hour_start, road);

ALTER TABLE ONLY public.autobahn_roads
    ADD CONSTRAINT autobahn_roads_pkey PRIMARY KEY (road);

ALTER TABLE ONLY public.bfrk_stops
    ADD CONSTRAINT bfrk_stops_pkey PRIMARY KEY (source_feed, dhid);

ALTER TABLE ONLY public.bw_detours
    ADD CONSTRAINT bw_detours_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.bw_detours
    ADD CONSTRAINT bw_detours_version_row UNIQUE (version_date, sheet_row);

ALTER TABLE ONLY public.charging_point_status
    ADD CONSTRAINT charging_point_status_pkey PRIMARY KEY (evse_id, observed_at);

ALTER TABLE ONLY public.charging_points
    ADD CONSTRAINT charging_points_pkey PRIMARY KEY (source_feed, point_key);

ALTER TABLE ONLY public.charging_sites
    ADD CONSTRAINT charging_sites_pkey PRIMARY KEY (source_feed, site_id);

ALTER TABLE ONLY public.charging_status_runs
    ADD CONSTRAINT charging_status_runs_key UNIQUE NULLS NOT DISTINCT (observed_at, source_feed, source_run_id, is_delta);

ALTER TABLE ONLY public.city_traffic_pulls
    ADD CONSTRAINT city_traffic_pulls_pkey PRIMARY KEY (feed_key);

ALTER TABLE ONLY public.city_traffic_segments
    ADD CONSTRAINT city_traffic_segments_key UNIQUE (source_feed, segment_key);

ALTER TABLE ONLY public.city_traffic_segments
    ADD CONSTRAINT city_traffic_segments_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.city_traffic_state
    ADD CONSTRAINT city_traffic_state_pkey PRIMARY KEY (segment_id);

ALTER TABLE ONLY public.db_facilities
    ADD CONSTRAINT db_facilities_pkey PRIMARY KEY (equipment_no);

ALTER TABLE ONLY public.db_station_boards
    ADD CONSTRAINT db_station_boards_pkey PRIMARY KEY (station_no);

ALTER TABLE ONLY public.db_station_numbers
    ADD CONSTRAINT db_station_numbers_pkey PRIMARY KEY (eva_no);

ALTER TABLE ONLY public.db_stations
    ADD CONSTRAINT db_stations_pkey PRIMARY KEY (station_no);

ALTER TABLE ONLY public.delfi_service_alerts
    ADD CONSTRAINT delfi_service_alerts_key UNIQUE (source_feed, alert_id);

ALTER TABLE ONLY public.delfi_service_alerts
    ADD CONSTRAINT delfi_service_alerts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.delfi_siri_et_calls_latest
    ADD CONSTRAINT delfi_siri_et_calls_latest_pkey PRIMARY KEY (stop_ref, service_day, journey_ref, visit, source_feed);

ALTER TABLE ONLY public.delfi_siri_et_stop_pairs
    ADD CONSTRAINT delfi_siri_et_stop_pairs_pkey PRIMARY KEY (eva, dhid);

ALTER TABLE ONLY public.deployments
    ADD CONSTRAINT deployments_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.energy_page_key_heads
    ADD CONSTRAINT energy_page_key_heads_pkey PRIMARY KEY (kind);

ALTER TABLE ONLY public.energy_page_keys
    ADD CONSTRAINT energy_page_keys_pkey PRIMARY KEY (kind, generation, ord);

ALTER TABLE ONLY public.energy_page_slug_history
    ADD CONSTRAINT energy_page_slug_history_pkey PRIMARY KEY (kind, slug);

ALTER TABLE ONLY public.energy_page_slugs
    ADD CONSTRAINT energy_page_slugs_pkey PRIMARY KEY (kind, source_feed, item_id);

ALTER TABLE ONLY public.error_events
    ADD CONSTRAINT error_events_pkey PRIMARY KEY (line_sha, hour);

ALTER TABLE ONLY public.feed_catalog
    ADD CONSTRAINT feed_catalog_pkey PRIMARY KEY (feed_key);

ALTER TABLE ONLY public.feed_run_extents
    ADD CONSTRAINT feed_run_extents_pkey PRIMARY KEY (feed_key);

ALTER TABLE public.feed_runs
    ADD CONSTRAINT feed_runs_budget_hit CHECK (((budget_hit IS NULL) OR (budget_hit = ANY (ARRAY['ceiling'::text, 'share'::text, 'reserved'::text, 'burst'::text, 'spacing'::text, 'yield'::text, 'hold'::text, 'no-budget'::text, 'no-share'::text, 'unavailable'::text])))) NOT VALID;

ALTER TABLE ONLY public.feed_runs
    ADD CONSTRAINT feed_runs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.feed_versions
    ADD CONSTRAINT feed_versions_pkey PRIMARY KEY (ledger, key);

ALTER TABLE ONLY public.feeds
    ADD CONSTRAINT feeds_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.feeds
    ADD CONSTRAINT feeds_provider_feed_version_key UNIQUE (provider, feed_version);

ALTER TABLE ONLY public.fuel_city_seed
    ADD CONSTRAINT fuel_city_seed_pkey PRIMARY KEY (ags);

ALTER TABLE ONLY public.fuel_price_latest
    ADD CONSTRAINT fuel_price_latest_pkey PRIMARY KEY (station_id, product);

ALTER TABLE ONLY public.fuel_prices
    ADD CONSTRAINT fuel_prices_pkey PRIMARY KEY (station_id, product, observed_at);

ALTER TABLE ONLY public.fuel_products
    ADD CONSTRAINT fuel_products_pkey PRIMARY KEY (code);

ALTER TABLE ONLY public.fuel_sample_draws
    ADD CONSTRAINT fuel_sample_draws_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.fuel_sample_strata
    ADD CONSTRAINT fuel_sample_strata_pkey PRIMARY KEY (draw_id, stratum);

ALTER TABLE ONLY public.fuel_station_watch
    ADD CONSTRAINT fuel_station_watch_pkey PRIMARY KEY (station_id);

ALTER TABLE ONLY public.fuel_stations
    ADD CONSTRAINT fuel_stations_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.gazetteer_places
    ADD CONSTRAINT gazetteer_places_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.gazetteer_places
    ADD CONSTRAINT gazetteer_places_source_id_external_id_key UNIQUE (source_id, external_id);

ALTER TABLE ONLY public.gbfs_stations
    ADD CONSTRAINT gbfs_stations_pkey PRIMARY KEY (system_id, station_id);

ALTER TABLE ONLY public.gbfs_systems
    ADD CONSTRAINT gbfs_systems_pkey PRIMARY KEY (system_id);

ALTER TABLE ONLY public.gbfs_vehicles
    ADD CONSTRAINT gbfs_vehicles_pkey PRIMARY KEY (system_id, seq);

ALTER TABLE ONLY public.growth_weekly
    ADD CONSTRAINT growth_weekly_pkey PRIMARY KEY (week);

ALTER TABLE ONLY public.gtfs_service_dates
    ADD CONSTRAINT gtfs_service_dates_pkey PRIMARY KEY (gtfs_feed_key, service_id, service_date);

ALTER TABLE ONLY public.gtfs_stale_trips
    ADD CONSTRAINT gtfs_stale_trips_pkey PRIMARY KEY (gtfs_feed_key, trip_id);

ALTER TABLE ONLY public.hh_cameras
    ADD CONSTRAINT hh_cameras_pkey PRIMARY KEY (camera_id);

ALTER TABLE ONLY public.hh_roadwork_versions
    ADD CONSTRAINT hh_roadwork_versions_pkey PRIMARY KEY (site_id, content_hash);

ALTER TABLE ONLY public.hh_roadworks
    ADD CONSTRAINT hh_roadworks_pkey PRIMARY KEY (site_id);

ALTER TABLE ONLY public.host_samples
    ADD CONSTRAINT host_samples_pkey PRIMARY KEY (sampled_at);

ALTER TABLE ONLY public.hydrogen_stations
    ADD CONSTRAINT hydrogen_stations_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.hydrogen_stations
    ADD CONSTRAINT hydrogen_stations_source_key UNIQUE (source_feed, external_id);

ALTER TABLE public.ingest_runs
    ADD CONSTRAINT ingest_runs_budget_hit CHECK (((budget_hit IS NULL) OR (budget_hit = ANY (ARRAY['ceiling'::text, 'share'::text, 'reserved'::text, 'burst'::text, 'spacing'::text, 'yield'::text, 'hold'::text, 'no-budget'::text, 'no-share'::text, 'unavailable'::text])))) NOT VALID;

ALTER TABLE ONLY public.ingest_runs
    ADD CONSTRAINT ingest_runs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.landing_collect_cursor
    ADD CONSTRAINT landing_collect_cursor_pkey PRIMARY KEY (stream);

ALTER TABLE ONLY public.landing_error_hourly
    ADD CONSTRAINT landing_error_hourly_pkey PRIMARY KEY (hour, kind, zone);

ALTER TABLE ONLY public.landing_reloads
    ADD CONSTRAINT landing_reloads_pkey PRIMARY KEY (at, service, action);

ALTER TABLE ONLY public.landing_status_hourly
    ADD CONSTRAINT landing_status_hourly_pkey PRIMARY KEY (hour, route_class, agent_class, status);

ALTER TABLE ONLY public.lez_zone_overlaps
    ADD CONSTRAINT lez_zone_overlaps_pkey PRIMARY KEY (source_feed, zone_id, other_feed, other_zone_id);

ALTER TABLE ONLY public.lez_zone_versions
    ADD CONSTRAINT lez_zone_versions_pkey PRIMARY KEY (source_feed, zone_id, content_hash);

ALTER TABLE ONLY public.lez_zones
    ADD CONSTRAINT lez_zones_pkey PRIMARY KEY (source_feed, zone_id);

ALTER TABLE ONLY public.lorry_city
    ADD CONSTRAINT lorry_city_key UNIQUE (source_feed, feature_key);

ALTER TABLE ONLY public.lorry_city
    ADD CONSTRAINT lorry_city_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.lorry_hb
    ADD CONSTRAINT lorry_hb_key UNIQUE (source_feed, feature_key);

ALTER TABLE ONLY public.lorry_hb
    ADD CONSTRAINT lorry_hb_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.lorry_ivm
    ADD CONSTRAINT lorry_ivm_key UNIQUE (source_feed, feature_key);

ALTER TABLE ONLY public.lorry_ivm
    ADD CONSTRAINT lorry_ivm_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.lorry_long_network
    ADD CONSTRAINT lorry_long_network_key UNIQUE (source_feed, feature_key);

ALTER TABLE ONLY public.lorry_long_network
    ADD CONSTRAINT lorry_long_network_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.lorry_sevas
    ADD CONSTRAINT lorry_sevas_key UNIQUE (source_feed, feature_key);

ALTER TABLE ONLY public.lorry_sevas
    ADD CONSTRAINT lorry_sevas_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.los_lane_sites
    ADD CONSTRAINT los_lane_sites_pkey PRIMARY KEY (lane_id);

ALTER TABLE ONLY public.los_lane_state
    ADD CONSTRAINT los_lane_state_pkey PRIMARY KEY (lane_id);

ALTER TABLE ONLY public.los_sites
    ADD CONSTRAINT los_sites_pkey PRIMARY KEY (site_id);

ALTER TABLE ONLY public.los_state
    ADD CONSTRAINT los_state_pkey PRIMARY KEY (site_id);

ALTER TABLE ONLY public.mcp_usage_exports
    ADD CONSTRAINT mcp_usage_exports_pkey PRIMARY KEY (destination, day);

ALTER TABLE ONLY public.mcp_usage
    ADD CONSTRAINT mcp_usage_pkey PRIMARY KEY (period, period_start, door, rpc, tool, client);

ALTER TABLE ONLY public.motorway_summary
    ADD CONSTRAINT motorway_summary_pkey PRIMARY KEY (road);

ALTER TABLE ONLY public.mvv_bus_load
    ADD CONSTRAINT mvv_bus_load_pkey PRIMARY KEY (day_type, dhid, line, direction, dep_time);

ALTER TABLE ONLY public.oom_kills
    ADD CONSTRAINT oom_kills_line_sha256_key UNIQUE (line_sha256);

ALTER TABLE ONLY public.oom_kills
    ADD CONSTRAINT oom_kills_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.opendata_roadwork_versions
    ADD CONSTRAINT opendata_roadwork_versions_pkey PRIMARY KEY (source_feed, site_id, content_hash);

ALTER TABLE ONLY public.opendata_roadworks
    ADD CONSTRAINT opendata_roadworks_pkey PRIMARY KEY (source_feed, site_id);

ALTER TABLE ONLY public.ops_audit
    ADD CONSTRAINT ops_audit_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.ops_passkeys
    ADD CONSTRAINT ops_passkeys_credential_id_key UNIQUE (credential_id);

ALTER TABLE ONLY public.ops_passkeys
    ADD CONSTRAINT ops_passkeys_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.ops_requests
    ADD CONSTRAINT ops_requests_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.ops_rollup_daily
    ADD CONSTRAINT ops_rollup_daily_pkey PRIMARY KEY (day, ledger, key);

ALTER TABLE ONLY public.ops_rollup_feed
    ADD CONSTRAINT ops_rollup_feed_pkey PRIMARY KEY (bucket_day, bucket_start, ledger, key);

ALTER TABLE ONLY public.ops_rollup_held
    ADD CONSTRAINT ops_rollup_held_pkey PRIMARY KEY (day, kind);

ALTER TABLE ONLY public.ops_rollup_usage
    ADD CONSTRAINT ops_rollup_usage_pkey PRIMARY KEY (day, tool, class);

ALTER TABLE ONLY public.osm_addresses
    ADD CONSTRAINT osm_addresses_osm_type_osm_id_key UNIQUE (osm_type, osm_id);

ALTER TABLE ONLY public.osm_addresses
    ADD CONSTRAINT osm_addresses_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.osm_boundary_de
    ADD CONSTRAINT osm_boundary_de_land_part_key UNIQUE (land, part);

ALTER TABLE ONLY public.osm_boundary_de
    ADD CONSTRAINT osm_boundary_de_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.osm_pois
    ADD CONSTRAINT osm_pois_osm_type_osm_id_key UNIQUE (osm_type, osm_id);

ALTER TABLE ONLY public.osm_pois
    ADD CONSTRAINT osm_pois_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.osm_replication_state
    ADD CONSTRAINT osm_replication_state_pkey PRIMARY KEY (land);

ALTER TABLE ONLY public.osm_speed_cameras
    ADD CONSTRAINT osm_speed_cameras_osm_type_osm_id_key UNIQUE (osm_type, osm_id);

ALTER TABLE ONLY public.osm_speed_cameras
    ADD CONSTRAINT osm_speed_cameras_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.osm_streets
    ADD CONSTRAINT osm_streets_osm_type_osm_id_key UNIQUE (osm_type, osm_id);

ALTER TABLE ONLY public.osm_streets
    ADD CONSTRAINT osm_streets_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.parkapi_stray_latch
    ADD CONSTRAINT parkapi_stray_latch_pkey PRIMARY KEY (feed_key, tripped_at);

ALTER TABLE ONLY public.parking_facilities_bysa
    ADD CONSTRAINT parking_facilities_bysa_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.parking_facilities_bysa
    ADD CONSTRAINT parking_facilities_bysa_source_key UNIQUE (source_feed, external_id);

ALTER TABLE ONLY public.parking_facilities_odbl
    ADD CONSTRAINT parking_facilities_odbl_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.parking_facilities_odbl
    ADD CONSTRAINT parking_facilities_odbl_source_key UNIQUE (source_feed, external_id);

ALTER TABLE ONLY public.parking_facilities
    ADD CONSTRAINT parking_facilities_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.parking_facilities_sid
    ADD CONSTRAINT parking_facilities_sid_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.parking_facilities_sid
    ADD CONSTRAINT parking_facilities_sid_source_key UNIQUE (source_feed, external_id);

ALTER TABLE ONLY public.parking_facilities
    ADD CONSTRAINT parking_facilities_source_key UNIQUE (source_feed, external_id);

ALTER TABLE ONLY public.parking_facility_refusals
    ADD CONSTRAINT parking_facility_refusals_pkey PRIMARY KEY (source_feed);

ALTER TABLE ONLY public.parking_forecast_profiles
    ADD CONSTRAINT parking_forecast_profiles_key UNIQUE (source_feed, source_version, facility_name, day_type, band_start);

ALTER TABLE ONLY public.parking_forecast_profiles
    ADD CONSTRAINT parking_forecast_profiles_pkey PRIMARY KEY (id);

ALTER TABLE public.parking_occupancy
    ADD CONSTRAINT parking_occupancy_implausible CHECK (((implausible_fields IS NULL) OR ((cardinality(implausible_fields) > 0) AND (implausible_fields <@ ARRAY['occupancy_pct'::text, 'spaces_free'::text, 'spaces_total'::text, 'feed_ts'::text])))) NOT VALID;

ALTER TABLE public.parking_occupancy_odbl
    ADD CONSTRAINT parking_occupancy_odbl_implausible CHECK (((implausible_fields IS NULL) OR ((cardinality(implausible_fields) > 0) AND (implausible_fields <@ ARRAY['occupancy_pct'::text, 'spaces_free'::text, 'spaces_total'::text, 'feed_ts'::text])))) NOT VALID;

ALTER TABLE public.parking_occupancy_odbl
    ADD CONSTRAINT parking_occupancy_odbl_pct CHECK (((occupancy_pct IS NULL) OR (occupancy_pct >= (0)::numeric))) NOT VALID;

ALTER TABLE ONLY public.parking_occupancy_odbl
    ADD CONSTRAINT parking_occupancy_odbl_pkey PRIMARY KEY (facility_id, observed_at);

ALTER TABLE public.parking_occupancy
    ADD CONSTRAINT parking_occupancy_pct CHECK (((occupancy_pct IS NULL) OR (occupancy_pct >= (0)::numeric))) NOT VALID;

ALTER TABLE ONLY public.parking_occupancy
    ADD CONSTRAINT parking_occupancy_pkey PRIMARY KEY (facility_id, observed_at);

ALTER TABLE public.parking_occupancy_sid
    ADD CONSTRAINT parking_occupancy_sid_implausible CHECK (((implausible_fields IS NULL) OR ((cardinality(implausible_fields) > 0) AND (implausible_fields <@ ARRAY['occupancy_pct'::text, 'spaces_free'::text, 'spaces_total'::text, 'feed_ts'::text])))) NOT VALID;

ALTER TABLE public.parking_occupancy_sid
    ADD CONSTRAINT parking_occupancy_sid_pct CHECK (((occupancy_pct IS NULL) OR (occupancy_pct >= (0)::numeric))) NOT VALID;

ALTER TABLE ONLY public.parking_occupancy_sid
    ADD CONSTRAINT parking_occupancy_sid_pkey PRIMARY KEY (facility_id, observed_at);

ALTER TABLE ONLY public.parking_sites
    ADD CONSTRAINT parking_sites_pkey PRIMARY KEY (site_id);

ALTER TABLE ONLY public.partition_archives
    ADD CONSTRAINT partition_archives_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.partition_archives
    ADD CONSTRAINT partition_archives_table_day UNIQUE (table_name, day);

ALTER TABLE ONLY public.partition_settings
    ADD CONSTRAINT partition_settings_pkey PRIMARY KEY (singleton);

ALTER TABLE ONLY public.place_slugs
    ADD CONSTRAINT place_slugs_pkey PRIMARY KEY (ags);

ALTER TABLE ONLY public.place_slugs
    ADD CONSTRAINT place_slugs_slug_key UNIQUE (slug);

ALTER TABLE ONLY public.place_website_checks
    ADD CONSTRAINT place_website_checks_pkey PRIMARY KEY (url);

ALTER TABLE ONLY public.place_websites
    ADD CONSTRAINT place_websites_pkey PRIMARY KEY (ags);

ALTER TABLE ONLY public.provider_key_claims
    ADD CONSTRAINT provider_key_claims_pkey PRIMARY KEY (provider);

ALTER TABLE ONLY public.road_context_feature_versions
    ADD CONSTRAINT road_context_feature_versions_pkey PRIMARY KEY (source_feed, feature_id, content_hash);

ALTER TABLE ONLY public.road_context_features
    ADD CONSTRAINT road_context_features_pkey PRIMARY KEY (source_feed, feature_id);

ALTER TABLE ONLY public.road_event_locations
    ADD CONSTRAINT road_event_locations_pkey PRIMARY KEY (road_event_id, seq);

ALTER TABLE ONLY public.road_event_record_types
    ADD CONSTRAINT road_event_record_types_pkey PRIMARY KEY (feed_key, record_type);

ALTER TABLE ONLY public.road_event_ticks
    ADD CONSTRAINT road_event_ticks_pkey PRIMARY KEY (source_id, publication_id, observed_at);

ALTER TABLE ONLY public.road_event_twins
    ADD CONSTRAINT road_event_twins_origin_once UNIQUE (origin_id);

ALTER TABLE ONLY public.road_event_twins
    ADD CONSTRAINT road_event_twins_pkey PRIMARY KEY (twin_id);

ALTER TABLE ONLY public.road_events
    ADD CONSTRAINT road_events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.road_events
    ADD CONSTRAINT road_events_source_id_publication_id_key UNIQUE (source_id, publication_id);

ALTER TABLE ONLY public.road_weather_forecast
    ADD CONSTRAINT road_weather_forecast_pkey PRIMARY KEY (station_id, valid_at);

ALTER TABLE ONLY public.road_weather_stations
    ADD CONSTRAINT road_weather_stations_pkey PRIMARY KEY (station_id);

ALTER TABLE ONLY public.routes
    ADD CONSTRAINT routes_pkey PRIMARY KEY (gtfs_feed_key, id);

ALTER TABLE ONLY public.runtime_config
    ADD CONSTRAINT runtime_config_pkey PRIMARY KEY (key);

ALTER TABLE ONLY public.search_console_weekly_parts
    ADD CONSTRAINT search_console_weekly_parts_pkey PRIMARY KEY (week, dimension, key);

ALTER TABLE ONLY public.search_console_weekly
    ADD CONSTRAINT search_console_weekly_pkey PRIMARY KEY (week);

ALTER TABLE ONLY public.site_visits_daily
    ADD CONSTRAINT site_visits_daily_pkey PRIMARY KEY (day);

ALTER TABLE ONLY public.site_visits_devices
    ADD CONSTRAINT site_visits_devices_pkey PRIMARY KEY (day, device);

ALTER TABLE ONLY public.site_visits_entries
    ADD CONSTRAINT site_visits_entries_pkey PRIMARY KEY (day, route);

ALTER TABLE ONLY public.site_visits_entry_referrers
    ADD CONSTRAINT site_visits_entry_referrers_pkey PRIMARY KEY (day, referrer);

ALTER TABLE ONLY public.site_visits_hourly
    ADD CONSTRAINT site_visits_hourly_pkey PRIMARY KEY (day, hour);

ALTER TABLE ONLY public.site_visits_pages_per_visit
    ADD CONSTRAINT site_visits_pages_per_visit_pkey PRIMARY KEY (day, bucket);

ALTER TABLE ONLY public.site_visits_referrers
    ADD CONSTRAINT site_visits_referrers_pkey PRIMARY KEY (day, referrer);

ALTER TABLE ONLY public.site_visits_routes
    ADD CONSTRAINT site_visits_routes_pkey PRIMARY KEY (day, route);

ALTER TABLE ONLY public.site_visits_search_engines
    ADD CONSTRAINT site_visits_search_engines_pkey PRIMARY KEY (day, engine);

ALTER TABLE ONLY public.source_hosts
    ADD CONSTRAINT source_hosts_pkey PRIMARY KEY (host);

ALTER TABLE ONLY public.source_schedule
    ADD CONSTRAINT source_schedule_pkey PRIMARY KEY (source_key);

ALTER TABLE ONLY public.speed_enforcement
    ADD CONSTRAINT speed_enforcement_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.speed_enforcement
    ADD CONSTRAINT speed_enforcement_source_key UNIQUE (source_feed, external_id);

ALTER TABLE ONLY public.station_accessibility
    ADD CONSTRAINT station_accessibility_pkey PRIMARY KEY (element_id);

ALTER TABLE ONLY public.station_equipment
    ADD CONSTRAINT station_equipment_pkey PRIMARY KEY (equipment_id);

ALTER TABLE ONLY public.station_equipment_state
    ADD CONSTRAINT station_equipment_state_pkey PRIMARY KEY (equipment_id);

ALTER TABLE ONLY public.station_metro_osm
    ADD CONSTRAINT station_metro_osm_pkey PRIMARY KEY (dhid);

ALTER TABLE ONLY public.station_slugs
    ADD CONSTRAINT station_slugs_pkey PRIMARY KEY (slug);

ALTER TABLE ONLY public.stop_access_odbl
    ADD CONSTRAINT stop_access_odbl_pkey PRIMARY KEY (source_feed, dhid);

ALTER TABLE ONLY public.stop_times
    ADD CONSTRAINT stop_times_pkey PRIMARY KEY (gtfs_feed_key, trip_id, stop_sequence);

ALTER TABLE ONLY public.stops
    ADD CONSTRAINT stops_pkey PRIMARY KEY (gtfs_feed_key, id);

ALTER TABLE ONLY public.street_bay_state
    ADD CONSTRAINT street_bay_state_pkey PRIMARY KEY (bay_id);

ALTER TABLE ONLY public.street_bays
    ADD CONSTRAINT street_bays_pkey PRIMARY KEY (bay_id);

ALTER TABLE ONLY public.tick_storage_days
    ADD CONSTRAINT tick_storage_days_pkey PRIMARY KEY (table_name, day);

ALTER TABLE ONLY public.tmc_locations
    ADD CONSTRAINT tmc_locations_pkey PRIMARY KEY (cid, tabcd, lcd);

ALTER TABLE ONLY public.traffic_count_latest
    ADD CONSTRAINT traffic_count_latest_pkey PRIMARY KEY (site_id, measure);

ALTER TABLE ONLY public.traffic_count_profiles
    ADD CONSTRAINT traffic_count_profiles_pkey PRIMARY KEY (site_id, month, day_kind, hour);

ALTER TABLE ONLY public.traffic_count_sites
    ADD CONSTRAINT traffic_count_sites_key UNIQUE (source_feed, site_key);

ALTER TABLE ONLY public.traffic_count_sites
    ADD CONSTRAINT traffic_count_sites_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.translation_cache
    ADD CONSTRAINT translation_cache_pkey PRIMARY KEY (key, lang, model);

ALTER TABLE ONLY public.trips
    ADD CONSTRAINT trips_pkey PRIMARY KEY (gtfs_feed_key, id);

ALTER TABLE ONLY public.validator_horizon
    ADD CONSTRAINT validator_horizon_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.watch_events
    ADD CONSTRAINT watch_events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.watches
    ADD CONSTRAINT watches_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.weather_warnings_en
    ADD CONSTRAINT weather_warnings_en_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.weather_warnings
    ADD CONSTRAINT weather_warnings_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.weather_warnings
    ADD CONSTRAINT weather_warnings_version_key UNIQUE (source_feed, identifier, warncell_id, version);

ALTER TABLE ONLY public.worker_boots
    ADD CONSTRAINT worker_boots_pkey PRIMARY KEY (id);

CREATE INDEX changes_budget ON control.changes USING btree (budget_key, at DESC);

CREATE INDEX providers_budget ON control.providers USING btree (budget_key);

CREATE INDEX refusals_at ON control.refusals USING btree (at);

CREATE INDEX refusals_budget ON control.refusals USING btree (budget_key, at DESC);

CREATE INDEX refusals_subject ON control.refusals USING btree (subject, at DESC) WHERE (subject IS NOT NULL);

CREATE INDEX road_works_geom ON domains.road_works USING gist (geom);

CREATE INDEX road_works_match ON domains.road_works USING btree (match_key) WHERE (closed_at IS NULL);

CREATE INDEX road_works_owner_open ON domains.road_works USING btree (source_id, feed) WHERE (closed_at IS NULL);

CREATE INDEX route_recommendations_geom ON domains.route_recommendations USING gist (geom);

CREATE INDEX route_recommendations_match ON domains.route_recommendations USING btree (match_key) WHERE (closed_at IS NULL);

CREATE INDEX route_recommendations_owner_open ON domains.route_recommendations USING btree (source_id, feed) WHERE (closed_at IS NULL);

CREATE INDEX speed_cameras_geom ON domains.speed_cameras USING gist (geom);

CREATE INDEX speed_cameras_match ON domains.speed_cameras USING btree (match_key) WHERE (closed_at IS NULL);

CREATE INDEX speed_cameras_owner_open ON domains.speed_cameras USING btree (source_id, feed) WHERE (closed_at IS NULL);

CREATE INDEX transit_agencies_odbl_match ON domains.transit_agencies_odbl USING btree (match_key) WHERE (closed_at IS NULL);

CREATE INDEX transit_agencies_odbl_owner_open ON domains.transit_agencies_odbl USING btree (source_id, feed) WHERE (closed_at IS NULL);

CREATE INDEX transit_routes_odbl_match ON domains.transit_routes_odbl USING btree (match_key) WHERE (closed_at IS NULL);

CREATE INDEX transit_routes_odbl_owner_open ON domains.transit_routes_odbl USING btree (source_id, feed) WHERE (closed_at IS NULL);

CREATE INDEX transit_routes_odbl_route ON domains.transit_routes_odbl USING btree (external_id, feed_version) WHERE (closed_at IS NULL);

CREATE INDEX transit_service_dates_odbl_match ON domains.transit_service_dates_odbl USING btree (match_key) WHERE (closed_at IS NULL);

CREATE INDEX transit_service_dates_odbl_owner_open ON domains.transit_service_dates_odbl USING btree (source_id, feed) WHERE (closed_at IS NULL);

CREATE INDEX transit_service_dates_odbl_service ON domains.transit_service_dates_odbl USING btree (service_id, service_date) WHERE (closed_at IS NULL);

CREATE INDEX transit_stop_times_odbl_match ON domains.transit_stop_times_odbl USING btree (match_key) WHERE (closed_at IS NULL);

CREATE INDEX transit_stop_times_odbl_owner_open ON domains.transit_stop_times_odbl USING btree (source_id, feed) WHERE (closed_at IS NULL);

CREATE INDEX transit_stop_times_odbl_stop ON domains.transit_stop_times_odbl USING btree (stop_id, departure_s) WHERE (closed_at IS NULL);

CREATE INDEX transit_stop_times_odbl_trip ON domains.transit_stop_times_odbl USING btree (trip_id, stop_sequence) WHERE (closed_at IS NULL);

CREATE INDEX transit_stops_odbl_geom ON domains.transit_stops_odbl USING gist (geom);

CREATE INDEX transit_stops_odbl_match ON domains.transit_stops_odbl USING btree (match_key) WHERE (closed_at IS NULL);

CREATE INDEX transit_stops_odbl_owner_open ON domains.transit_stops_odbl USING btree (source_id, feed) WHERE (closed_at IS NULL);

CREATE INDEX transit_trip_updates_odbl_match ON domains.transit_trip_updates_odbl USING btree (match_key) WHERE (closed_at IS NULL);

CREATE INDEX transit_trip_updates_odbl_owner_open ON domains.transit_trip_updates_odbl USING btree (source_id, feed) WHERE (closed_at IS NULL);

CREATE INDEX transit_trip_updates_odbl_trip ON domains.transit_trip_updates_odbl USING btree (trip_id, start_date) WHERE (closed_at IS NULL);

CREATE INDEX transit_trips_odbl_match ON domains.transit_trips_odbl USING btree (match_key) WHERE (closed_at IS NULL);

CREATE INDEX transit_trips_odbl_owner_open ON domains.transit_trips_odbl USING btree (source_id, feed) WHERE (closed_at IS NULL);

CREATE INDEX transit_trips_odbl_trip ON domains.transit_trips_odbl USING btree (external_id) WHERE (closed_at IS NULL);

CREATE INDEX run_errors_at ON ingestor.run_errors USING btree (at);

CREATE INDEX run_errors_run ON ingestor.run_errors USING btree (run_id);

CREATE INDEX runs_source_started ON ingestor.runs USING btree (source_id, started_at DESC);

CREATE INDEX runs_started ON ingestor.runs USING btree (started_at);

CREATE INDEX ags_regions_geom_gist ON public.ags_regions USING gist (geom) WHERE (geom IS NOT NULL);

CREATE INDEX ags_regions_name_trgm ON public.ags_regions USING gin (name_norm public.gin_trgm_ops);

CREATE INDEX ags_regions_parent ON public.ags_regions USING btree (parent_ags) WHERE (parent_ags IS NOT NULL);

CREATE INDEX alarm_episodes_cleared_at_idx ON public.alarm_episodes USING btree (cleared_at) WHERE (cleared_at IS NOT NULL);

CREATE UNIQUE INDEX alarm_episodes_open_uq ON public.alarm_episodes USING btree (feed_key, kind) WHERE (cleared_at IS NULL);

CREATE INDEX autobahn_events_brin ON ONLY public.autobahn_events USING brin (observed_at);

CREATE INDEX autobahn_events_raw_dedup ON ONLY public.autobahn_events USING btree (ext_id, observed_at DESC) WHERE ((raw IS NOT NULL) AND (raw_hash IS NOT NULL));

CREATE INDEX autobahn_events_recent ON ONLY public.autobahn_events USING btree (observed_at DESC);

CREATE INDEX autobahn_events_road ON ONLY public.autobahn_events USING btree (road, observed_at DESC);

CREATE INDEX bfrk_stops_dhid ON public.bfrk_stops USING btree (dhid) WHERE (closed_at IS NULL);

CREATE INDEX bfrk_stops_geom ON public.bfrk_stops USING gist (geom) WHERE (closed_at IS NULL);

CREATE INDEX bw_detours_autobahn_open ON public.bw_detours USING btree (autobahn) WHERE (closed_at IS NULL);

CREATE INDEX charging_point_status_brin ON ONLY public.charging_point_status USING brin (observed_at);

CREATE INDEX charging_points_deleted ON public.charging_points USING btree (deleted_at) WHERE (deleted_at IS NOT NULL);

CREATE INDEX charging_points_evse ON public.charging_points USING btree (evse_id) WHERE (evse_id IS NOT NULL);

CREATE INDEX charging_points_evse_norm ON public.charging_points USING btree (upper(translate(evse_id, '*-'::text, ''::text))) WHERE (evse_id IS NOT NULL);

CREATE INDEX charging_points_geom_gist ON public.charging_points USING gist (geom) WHERE (closed_at IS NULL);

CREATE INDEX charging_points_open_feed ON public.charging_points USING btree (source_feed) WHERE ((closed_at IS NULL) AND (deleted_at IS NULL) AND (COALESCE(confidentiality, 'noRestriction'::text) = 'noRestriction'::text));

CREATE INDEX charging_points_open_site ON public.charging_points USING btree (source_feed, site_id) INCLUDE (point_key, evse_id, provider_point_id, connector_types, max_power_kw) WHERE ((closed_at IS NULL) AND (deleted_at IS NULL) AND (COALESCE(confidentiality, 'noRestriction'::text) = 'noRestriction'::text));

CREATE INDEX charging_points_operator ON public.charging_points USING btree (operator, source_feed) WHERE (closed_at IS NULL);

CREATE INDEX charging_points_provider_point ON public.charging_points USING btree (source_feed, provider_point_id) WHERE (provider_point_id IS NOT NULL);

CREATE INDEX charging_points_site ON public.charging_points USING btree (source_feed, site_id);

CREATE INDEX charging_sites_deleted ON public.charging_sites USING btree (deleted_at) WHERE (deleted_at IS NOT NULL);

CREATE INDEX charging_sites_geom_gist ON public.charging_sites USING gist (geom) WHERE (closed_at IS NULL);

CREATE INDEX charging_sites_page_key ON public.charging_sites USING btree (public.vf_page_key(((('charging:'::text || source_feed) || ':'::text) || site_id)));

CREATE INDEX charging_sites_withheld_site ON public.charging_sites USING btree (site_id) WHERE ((closed_at IS NULL) AND (COALESCE(confidentiality, 'noRestriction'::text) <> 'noRestriction'::text));

CREATE INDEX city_traffic_segments_geom_gist ON public.city_traffic_segments USING gist (geom);

CREATE INDEX city_traffic_state_feed ON public.city_traffic_state USING btree (source_feed, last_seen_at);

CREATE INDEX city_traffic_ticks_brin ON ONLY public.city_traffic_ticks USING brin (observed_at);

CREATE UNIQUE INDEX city_traffic_ticks_pkey ON ONLY public.city_traffic_ticks USING btree (segment_id, observed_at);

CREATE INDEX connect_transit_delays_brin ON ONLY public.connect_transit_delays USING brin (observed_at);

CREATE INDEX connect_transit_delays_trip ON ONLY public.connect_transit_delays USING btree (trip_id, observed_at DESC);

CREATE INDEX db_facilities_not_active ON public.db_facilities USING btree (state, kind) WHERE (state <> 'active'::text);

CREATE INDEX db_facilities_station ON public.db_facilities USING btree (station_no);

CREATE UNIQUE INDEX db_facility_ticks_pkey ON ONLY public.db_facility_ticks USING btree (equipment_no, observed_at);

CREATE INDEX db_station_boards_evas_gin ON public.db_station_boards USING gin (eva_nos);

CREATE INDEX db_station_numbers_station_no ON public.db_station_numbers USING btree (station_no);

CREATE INDEX db_stations_evas ON public.db_stations USING gin (eva_nos);

CREATE INDEX db_stations_geom_open ON public.db_stations USING gist (geom) WHERE (closed_at IS NULL);

CREATE INDEX delfi_service_alerts_open ON public.delfi_service_alerts USING gin (lands) WHERE (closed_at IS NULL);

CREATE INDEX delfi_service_alerts_open_kreise ON public.delfi_service_alerts USING gin (kreise) WHERE (closed_at IS NULL);

CREATE INDEX delfi_siri_et_calls_latest_departed ON public.delfi_siri_et_calls_latest USING btree (aimed_dep);

CREATE INDEX delfi_siri_et_calls_latest_next ON public.delfi_siri_et_calls_latest USING btree (stop_ref, COALESCE(expected_dep, aimed_dep));

CREATE INDEX delfi_siri_et_calls_observed_brin ON ONLY public.delfi_siri_et_calls USING brin (observed_at);

CREATE INDEX delfi_siri_et_calls_stop ON ONLY public.delfi_siri_et_calls USING btree (stop_ref, observed_at);

CREATE INDEX delfi_siri_et_stop_pairs_dhid ON public.delfi_siri_et_stop_pairs USING btree (dhid);

CREATE INDEX delfi_siri_et_stop_pairs_station ON public.delfi_siri_et_stop_pairs USING btree (station_dhid);

CREATE INDEX deployments_deployed_at_idx ON public.deployments USING btree (deployed_at DESC);

CREATE INDEX energy_page_keys_feed ON public.energy_page_keys USING btree (kind, generation, source_feed, ord) WHERE (source_feed IS NOT NULL);

CREATE UNIQUE INDEX energy_page_slugs_slug ON public.energy_page_slugs USING btree (kind, slug);

CREATE INDEX error_events_hour_idx ON public.error_events USING btree (hour);

CREATE INDEX feed_runs_feed_body_refused ON public.feed_runs USING btree (feed_key, started_at DESC) WHERE (((status = ANY (ARRAY['degraded'::text, 'error'::text])) AND (body_sha256 IS NOT NULL) AND (etag IS NULL) AND (last_modified IS NULL)) OR ((status = ANY (ARRAY['pending'::text, 'skipped'::text])) AND (COALESCE(items_closed, 0) > 0) AND (body_sha256 IS NULL)));

CREATE INDEX feed_runs_feed_changed ON public.feed_runs USING btree (feed_key, finished_at DESC) WHERE ((finished_at IS NOT NULL) AND (budget_hit IS NULL) AND (((COALESCE(items_inserted, 0) + COALESCE(items_updated, 0)) + COALESCE(items_closed, 0)) > 0));

CREATE INDEX feed_runs_feed_etag ON public.feed_runs USING btree (feed_key, started_at DESC) INCLUDE (reader_epoch) WHERE (etag IS NOT NULL);

CREATE INDEX feed_runs_feed_finished ON public.feed_runs USING btree (feed_key, finished_at DESC) INCLUDE (status, items_seen, started_at) WHERE (finished_at IS NOT NULL);

CREATE INDEX feed_runs_feed_jumped ON public.feed_runs USING btree (feed_key, started_at DESC) WHERE jumped;

CREATE INDEX feed_runs_feed_last_modified ON public.feed_runs USING btree (feed_key, started_at DESC) INCLUDE (reader_epoch) WHERE (last_modified IS NOT NULL);

CREATE INDEX feed_runs_feed_refused ON public.feed_runs USING btree (feed_key, finished_at DESC) INCLUDE (status, budget_hit) WHERE ((finished_at IS NOT NULL) AND (budget_hit IS NOT NULL));

CREATE INDEX feed_runs_feed_snapshot ON public.feed_runs USING btree (feed_key, started_at DESC) INCLUDE (status, items_seen) WHERE COALESCE((lower(btrim(exchange_protocol)) ~~ 'snapshot%'::text), false);

CREATE INDEX feed_runs_feed_started ON public.feed_runs USING btree (feed_key, started_at DESC);

CREATE INDEX feed_runs_feed_validator ON public.feed_runs USING btree (feed_key, started_at DESC) WHERE (COALESCE(etag, last_modified) IS NOT NULL);

CREATE UNIQUE INDEX feeds_gtfs_feed_key ON public.feeds USING btree (gtfs_feed_key);

CREATE UNIQUE INDEX feeds_one_active_per_provider ON public.feeds USING btree (provider) WHERE active;

CREATE INDEX fuel_price_latest_deleted ON public.fuel_price_latest USING btree (deleted_at) WHERE (deleted_at IS NOT NULL);

CREATE INDEX fuel_prices_brin ON ONLY public.fuel_prices USING brin (observed_at);

CREATE INDEX fuel_station_watch_due_idx ON public.fuel_station_watch USING btree (active, priority, last_polled_at NULLS FIRST);

CREATE INDEX fuel_station_watch_sample_stratum ON public.fuel_station_watch USING btree (sample_stratum) WHERE (sample_stratum IS NOT NULL);

CREATE INDEX fuel_stations_deleted ON public.fuel_stations USING btree (deleted_at) WHERE (deleted_at IS NOT NULL);

CREATE INDEX fuel_stations_detail_stale ON public.fuel_stations USING btree (detail_refreshed_at NULLS FIRST);

CREATE INDEX fuel_stations_geom_gist ON public.fuel_stations USING gist (geom);

CREATE INDEX fuel_stations_page_key ON public.fuel_stations USING btree (public.vf_page_key(('fuel:'::text || id)));

CREATE INDEX gazetteer_places_admin_code ON public.gazetteer_places USING btree (admin_code) WHERE ((admin_code IS NOT NULL) AND (closed_at IS NULL));

CREATE INDEX gazetteer_places_bkg_city_geom_gist ON public.gazetteer_places USING gist (geom) WHERE ((source_id = 'bkg_gvisys'::text) AND (kind = 'city'::text) AND (closed_at IS NULL) AND (geom IS NOT NULL));

CREATE INDEX gazetteer_places_geom_gist ON public.gazetteer_places USING gist (geom) WHERE ((geom IS NOT NULL) AND (closed_at IS NULL));

CREATE INDEX gazetteer_places_geonames_name_en ON public.gazetteer_places USING btree (lower(name_en)) WHERE ((closed_at IS NULL) AND (kind = 'city'::text) AND (source_id = 'geonames'::text) AND (name_en IS NOT NULL) AND (geom IS NOT NULL));

CREATE INDEX gazetteer_places_kind_rank ON public.gazetteer_places USING btree (kind, rank DESC);

CREATE INDEX gazetteer_places_name_en_trgm ON public.gazetteer_places USING gin (lower(name_en) public.gin_trgm_ops) WHERE (name_en IS NOT NULL);

CREATE INDEX gazetteer_places_name_norm_btree ON public.gazetteer_places USING btree (name_norm) WHERE (closed_at IS NULL);

CREATE INDEX gazetteer_places_name_norm_pattern ON public.gazetteer_places USING btree (name_norm text_pattern_ops) WHERE (closed_at IS NULL);

CREATE INDEX gazetteer_places_name_trgm ON public.gazetteer_places USING gin (name_norm public.gin_trgm_ops);

CREATE INDEX gazetteer_places_road ON public.gazetteer_places USING btree (road) WHERE (road IS NOT NULL);

CREATE INDEX gbfs_station_status_observed_brin ON ONLY public.gbfs_station_status USING brin (observed_at);

CREATE UNIQUE INDEX gbfs_station_status_pkey ON ONLY public.gbfs_station_status USING btree (system_id, station_id, observed_at);

CREATE INDEX gbfs_stations_geom_open ON public.gbfs_stations USING gist (geom) WHERE (closed_at IS NULL);

CREATE INDEX gbfs_vehicles_geom ON public.gbfs_vehicles USING gist (geom);

CREATE UNIQUE INDEX gtfs_route_kreise_key ON public.gtfs_route_kreise USING btree (gtfs_feed_key, route_id);

CREATE INDEX gtfs_service_dates_date ON public.gtfs_service_dates USING btree (gtfs_feed_key, service_date);

CREATE UNIQUE INDEX gtfs_untimed_trips_key ON public.gtfs_untimed_trips USING btree (gtfs_feed_key, trip_id);

CREATE INDEX hh_cameras_open_geom ON public.hh_cameras USING gist (geom) WHERE (closed_at IS NULL);

CREATE INDEX hh_roadwork_versions_observed ON public.hh_roadwork_versions USING btree (site_id, observed_at DESC);

CREATE INDEX hh_roadworks_answerable_geom ON public.hh_roadworks USING gist (geom) WHERE ((closed_at IS NULL) AND released);

CREATE INDEX hydrogen_stations_geom_gist ON public.hydrogen_stations USING gist (geom);

CREATE INDEX ingest_runs_provider ON public.ingest_runs USING btree (provider, started_at DESC);

CREATE INDEX ingest_runs_provider_changed ON public.ingest_runs USING btree (provider, finished_at DESC) WHERE ((finished_at IS NOT NULL) AND (budget_hit IS NULL) AND (COALESCE(rows, 0) > 0));

CREATE INDEX ingest_runs_provider_finished ON public.ingest_runs USING btree (provider, finished_at DESC) INCLUDE (status) WHERE (finished_at IS NOT NULL);

CREATE INDEX ingest_runs_provider_ok_finished ON public.ingest_runs USING btree (provider, finished_at DESC) WHERE (status = 'ok'::text);

CREATE INDEX ingest_runs_provider_refused ON public.ingest_runs USING btree (provider, finished_at DESC) INCLUDE (status, budget_hit) WHERE ((finished_at IS NOT NULL) AND (budget_hit IS NOT NULL));

CREATE INDEX lez_zone_overlaps_other ON public.lez_zone_overlaps USING btree (other_feed, other_zone_id);

CREATE INDEX lez_zone_versions_observed ON public.lez_zone_versions USING btree (source_feed, zone_id, observed_at DESC);

CREATE INDEX lez_zones_open_geom ON public.lez_zones USING gist (geom) WHERE (closed_at IS NULL);

CREATE INDEX lez_zones_open_geom_m ON public.lez_zones USING gist (geom_m) WHERE (closed_at IS NULL);

CREATE INDEX lorry_city_geom_open ON public.lorry_city USING gist (geom) WHERE (closed_at IS NULL);

CREATE INDEX lorry_hb_geom_open ON public.lorry_hb USING gist (geom) WHERE (closed_at IS NULL);

CREATE INDEX lorry_ivm_geom_open ON public.lorry_ivm USING gist (geom) WHERE (closed_at IS NULL);

CREATE INDEX lorry_long_network_geom_open ON public.lorry_long_network USING gist (geom) WHERE (closed_at IS NULL);

CREATE INDEX lorry_long_network_road_open ON public.lorry_long_network USING btree (road) WHERE (closed_at IS NULL);

CREATE INDEX lorry_sevas_geom_open ON public.lorry_sevas USING gist (geom) WHERE (closed_at IS NULL);

CREATE INDEX los_lane_sites_site_open ON public.los_lane_sites USING btree (site_id) WHERE (closed_at IS NULL);

CREATE INDEX los_lane_state_site ON public.los_lane_state USING btree (site_id);

CREATE INDEX los_sites_geom_gist ON public.los_sites USING gist (geom) WHERE (closed_at IS NULL);

CREATE INDEX los_sites_road_open ON public.los_sites USING btree (road) WHERE (closed_at IS NULL);

CREATE UNIQUE INDEX los_ticks_pkey ON ONLY public.los_ticks USING btree (site_id, observed_at);

CREATE INDEX mcp_usage_period_start ON public.mcp_usage USING btree (period_start);

CREATE INDEX mvv_bus_load_lookup ON public.mvv_bus_load USING btree (dhid, line, dep_time) WHERE (closed_at IS NULL);

CREATE INDEX oom_kills_container_killed ON public.oom_kills USING btree (container, killed_at DESC);

CREATE INDEX oom_kills_killed_at ON public.oom_kills USING btree (killed_at DESC);

CREATE INDEX opendata_roadwork_versions_observed ON public.opendata_roadwork_versions USING btree (source_feed, site_id, observed_at DESC);

CREATE INDEX opendata_roadworks_answerable_anchor ON public.opendata_roadworks USING gist (anchor) WHERE ((closed_at IS NULL) AND answerable AND affects_traffic);

CREATE INDEX opendata_roadworks_answerable_geom ON public.opendata_roadworks USING gist (geom) WHERE ((closed_at IS NULL) AND answerable AND affects_traffic);

CREATE INDEX opendata_roadworks_feed_open ON public.opendata_roadworks USING btree (source_feed) WHERE (closed_at IS NULL);

CREATE INDEX ops_audit_at ON public.ops_audit USING btree (at DESC);

CREATE INDEX ops_requests_pending ON public.ops_requests USING btree (requested_at) WHERE (state = 'pending'::text);

CREATE INDEX ops_requests_target ON public.ops_requests USING btree (target, requested_at DESC);

CREATE INDEX ops_rollup_feed_key ON ONLY public.ops_rollup_feed USING btree (ledger, key, bucket_start);

CREATE INDEX osm_addresses_geom_gist ON public.osm_addresses USING gist (geom) WHERE (closed_at IS NULL);

CREATE INDEX osm_addresses_open_land ON public.osm_addresses USING btree (land, last_seen_at) WHERE (closed_at IS NULL);

CREATE INDEX osm_addresses_postcode ON public.osm_addresses USING btree (postcode) WHERE (closed_at IS NULL);

CREATE INDEX osm_addresses_street_number_place ON public.osm_addresses USING btree (street_norm, house_number_norm, place_norm text_pattern_ops) WHERE (closed_at IS NULL);

CREATE INDEX osm_addresses_street_place ON public.osm_addresses USING btree (street_norm, place_norm, house_number_norm) WHERE (closed_at IS NULL);

CREATE INDEX osm_addresses_street_postcode ON public.osm_addresses USING btree (street_norm, postcode, house_number_norm) WHERE (closed_at IS NULL);

CREATE INDEX osm_boundary_de_geom ON public.osm_boundary_de USING gist (geom);

CREATE INDEX osm_pois_brand_trgm ON public.osm_pois USING gin (brand public.gin_trgm_ops) WHERE (brand IS NOT NULL);

CREATE INDEX osm_pois_everyday_geom ON public.osm_pois USING gist (geom) WHERE ((closed_at IS NULL) AND (((category || '='::text) || category_value) = ANY (ARRAY['amenity=pharmacy'::text, 'healthcare=pharmacy'::text, 'amenity=hospital'::text, 'amenity=clinic'::text, 'amenity=doctors'::text, 'healthcare=hospital'::text, 'healthcare=clinic'::text, 'healthcare=doctor'::text, 'building=hospital'::text, 'shop=supermarket'::text, 'building=supermarket'::text, 'amenity=atm'::text, 'amenity=bank'::text, 'amenity=police'::text, 'amenity=toilets'::text, 'amenity=post_office'::text])));

CREATE INDEX osm_pois_fuel_geom ON public.osm_pois USING gist (geom) WHERE ((closed_at IS NULL) AND (category = 'amenity'::text) AND (category_value = 'fuel'::text));

CREATE INDEX osm_pois_geom ON public.osm_pois USING gist (geom);

CREATE INDEX osm_pois_junction_geom ON public.osm_pois USING gist (geom) WHERE ((closed_at IS NULL) AND (category = 'highway'::text) AND (category_value = 'motorway_junction'::text));

CREATE INDEX osm_pois_kind ON public.osm_pois USING btree (category_value, category) WHERE (closed_at IS NULL);

CREATE INDEX osm_pois_metro_station_geom ON public.osm_pois USING gist (geom) WHERE ((closed_at IS NULL) AND (category = 'railway'::text));

CREATE INDEX osm_pois_name_norm ON public.osm_pois USING btree (name_norm) WHERE (closed_at IS NULL);

CREATE INDEX osm_pois_name_trgm ON public.osm_pois USING gin (name_norm public.gin_trgm_ops);

CREATE INDEX osm_pois_nearby_geom ON public.osm_pois USING gist (geom) WHERE ((closed_at IS NULL) AND (((category || '='::text) || category_value) = ANY (ARRAY['amenity=toilets'::text, 'amenity=shower'::text, 'amenity=restaurant'::text, 'amenity=fast_food'::text, 'amenity=cafe'::text, 'shop=convenience'::text, 'shop=kiosk'::text, 'shop=supermarket'::text, 'amenity=drinking_water'::text])));

CREATE INDEX osm_pois_need_food_geom ON public.osm_pois USING gist (geom) WHERE ((closed_at IS NULL) AND (((category || '='::text) || category_value) = ANY (ARRAY['amenity=restaurant'::text, 'amenity=cafe'::text, 'amenity=fast_food'::text])));

CREATE INDEX osm_pois_need_garage_geom ON public.osm_pois USING gist (geom) WHERE ((closed_at IS NULL) AND (((category || '='::text) || category_value) = ANY (ARRAY['shop=car_repair'::text, 'shop=tyres'::text, 'amenity=car_wash'::text])));

CREATE INDEX osm_pois_need_groceries_geom ON public.osm_pois USING gist (geom) WHERE ((closed_at IS NULL) AND (((category || '='::text) || category_value) = ANY (ARRAY['shop=supermarket'::text, 'building=supermarket'::text, 'shop=convenience'::text, 'shop=bakery'::text, 'shop=butcher'::text, 'shop=kiosk'::text, 'shop=chemist'::text])));

CREATE INDEX osm_pois_need_health_geom ON public.osm_pois USING gist (geom) WHERE ((closed_at IS NULL) AND (((category || '='::text) || category_value) = ANY (ARRAY['amenity=pharmacy'::text, 'healthcare=pharmacy'::text, 'amenity=doctors'::text, 'healthcare=doctor'::text, 'amenity=dentist'::text, 'healthcare=dentist'::text, 'amenity=hospital'::text, 'healthcare=hospital'::text, 'building=hospital'::text, 'amenity=clinic'::text, 'healthcare=clinic'::text])));

CREATE INDEX osm_pois_need_lodging_geom ON public.osm_pois USING gist (geom) WHERE ((closed_at IS NULL) AND (((category || '='::text) || category_value) = ANY (ARRAY['tourism=hotel'::text, 'tourism=guest_house'::text, 'tourism=motel'::text, 'tourism=hostel'::text])));

CREATE INDEX osm_pois_need_money_geom ON public.osm_pois USING gist (geom) WHERE ((closed_at IS NULL) AND (((category || '='::text) || category_value) = ANY (ARRAY['amenity=atm'::text, 'amenity=bank'::text, 'amenity=post_office'::text])));

CREATE INDEX osm_pois_need_police_geom ON public.osm_pois USING gist (geom) WHERE ((closed_at IS NULL) AND (((category || '='::text) || category_value) = 'amenity=police'::text));

CREATE INDEX osm_pois_need_toilets_geom ON public.osm_pois USING gist (geom) WHERE ((closed_at IS NULL) AND (((category || '='::text) || category_value) = 'amenity=toilets'::text));

CREATE INDEX osm_pois_open_land ON public.osm_pois USING btree (land, last_seen_at) WHERE (closed_at IS NULL);

CREATE INDEX osm_pois_parking_geom ON public.osm_pois USING gist (geom) WHERE ((closed_at IS NULL) AND (category = 'amenity'::text) AND (category_value = 'parking'::text));

CREATE INDEX osm_pois_place_kind ON public.osm_pois USING btree (place_norm, category_value, category) WHERE ((closed_at IS NULL) AND (place_norm IS NOT NULL));

CREATE INDEX osm_pois_place_name ON public.osm_pois USING btree (place_norm, name_norm) WHERE ((closed_at IS NULL) AND (place_norm IS NOT NULL));

CREATE INDEX osm_speed_cameras_geom_open ON public.osm_speed_cameras USING gist (geom) WHERE (closed_at IS NULL);

CREATE INDEX osm_speed_cameras_open_land ON public.osm_speed_cameras USING btree (land, last_seen_at) WHERE (closed_at IS NULL);

CREATE UNIQUE INDEX osm_street_tiles_cell ON public.osm_street_tiles USING btree (cls, tx, ty);

CREATE INDEX osm_street_tiles_geom ON public.osm_street_tiles USING gist (geom);

CREATE UNIQUE INDEX osm_street_tiles_lo_cell ON public.osm_street_tiles_lo USING btree (cls, tx, ty);

CREATE INDEX osm_street_tiles_lo_geom ON public.osm_street_tiles_lo USING gist (geom);

CREATE INDEX osm_street_tiles_lo_trunk ON public.osm_street_tiles_lo USING gist (geom) WHERE (cls = 2);

CREATE INDEX osm_streets_geom_open ON public.osm_streets USING gist (geom) WHERE (closed_at IS NULL);

CREATE INDEX osm_streets_lo_secondary ON public.osm_streets USING gist (geom_lo) WHERE ((closed_at IS NULL) AND (cls <= 4));

CREATE INDEX osm_streets_lo_trunk ON public.osm_streets USING gist (geom_lo) WHERE ((closed_at IS NULL) AND (cls <= 2));

CREATE INDEX osm_streets_open_land ON public.osm_streets USING btree (land, last_seen_at) WHERE (closed_at IS NULL);

CREATE UNIQUE INDEX parkapi_stray_latch_open ON public.parkapi_stray_latch USING btree (feed_key) WHERE (cleared_at IS NULL);

CREATE INDEX parking_facilities_bysa_geom_gist ON public.parking_facilities_bysa USING gist (geom);

CREATE INDEX parking_facilities_bysa_road ON public.parking_facilities_bysa USING btree (road, kind) WHERE (closed_at IS NULL);

CREATE INDEX parking_facilities_deleted ON public.parking_facilities USING btree (deleted_at) WHERE (deleted_at IS NOT NULL);

CREATE INDEX parking_facilities_geom_gist ON public.parking_facilities USING gist (geom);

CREATE INDEX parking_facilities_odbl_geom_gist ON public.parking_facilities_odbl USING gist (geom);

CREATE INDEX parking_facilities_odbl_road ON public.parking_facilities_odbl USING btree (road, kind) WHERE (closed_at IS NULL);

CREATE INDEX parking_facilities_road ON public.parking_facilities USING btree (road, kind) WHERE ((closed_at IS NULL) AND (deleted_at IS NULL));

CREATE INDEX parking_facilities_sid_geom_gist ON public.parking_facilities_sid USING gist (geom);

CREATE INDEX parking_facilities_station ON public.parking_facilities USING btree (station_name_norm, kind) WHERE ((station_name_norm IS NOT NULL) AND (closed_at IS NULL) AND (deleted_at IS NULL));

CREATE INDEX parking_forecast_profiles_current ON public.parking_forecast_profiles USING btree (facility_id, day_type, band_start) WHERE ((superseded_at IS NULL) AND (deleted_at IS NULL));

CREATE INDEX parking_forecast_profiles_deleted ON public.parking_forecast_profiles USING btree (deleted_at) WHERE (deleted_at IS NOT NULL);

CREATE INDEX parking_occupancy_brin ON ONLY public.parking_occupancy USING brin (observed_at);

CREATE INDEX parking_occupancy_sid_brin ON ONLY public.parking_occupancy_sid USING brin (observed_at);

CREATE INDEX parking_sites_deleted ON public.parking_sites USING btree (deleted_at) WHERE (deleted_at IS NOT NULL);

CREATE INDEX parking_sites_geom_gist ON public.parking_sites USING gist (geom);

CREATE INDEX partition_archives_table_day_desc ON public.partition_archives USING btree (table_name, day DESC);

CREATE INDEX place_website_checks_checked_at ON public.place_website_checks USING btree (checked_at);

CREATE INDEX road_context_features_answerable_geom ON public.road_context_features USING gist (geom) WHERE ((closed_at IS NULL) AND answerable);

CREATE INDEX road_context_features_feed_open ON public.road_context_features USING btree (source_feed) WHERE (closed_at IS NULL);

CREATE INDEX road_event_locations_deleted ON public.road_event_locations USING btree (deleted_at) WHERE (deleted_at IS NOT NULL);

CREATE INDEX road_event_locations_road ON public.road_event_locations USING btree (road_number, road_event_id);

CREATE INDEX road_event_ticks_brin ON ONLY public.road_event_ticks USING brin (observed_at);

CREATE INDEX road_events_deleted ON public.road_events USING btree (deleted_at) WHERE (deleted_at IS NOT NULL);

CREATE INDEX road_events_geom_gist ON public.road_events USING gist (geom) WHERE (geom IS NOT NULL);

CREATE INDEX road_events_open ON public.road_events USING btree (road_number, overall_start DESC) WHERE (closed_at IS NULL);

CREATE INDEX road_events_ref_key ON public.road_events USING btree (public.road_ref_key(road_number), feed_key) WHERE (road_number IS NOT NULL);

CREATE INDEX road_weather_stations_geom ON public.road_weather_stations USING gist (geom) WHERE ((closed_at IS NULL) AND (NOT inactive));

CREATE INDEX routes_deleted ON public.routes USING btree (deleted_at) WHERE (deleted_at IS NOT NULL);

CREATE INDEX routes_short_name ON public.routes USING btree (gtfs_feed_key, short_name);

CREATE INDEX source_schedule_host ON public.source_schedule USING btree (host);

CREATE INDEX speed_enforcement_ags ON public.speed_enforcement USING btree (ags) WHERE ((closed_at IS NULL) AND (geom IS NULL));

CREATE INDEX speed_enforcement_geom_gist ON public.speed_enforcement USING gist (geom) WHERE (closed_at IS NULL);

CREATE INDEX station_accessibility_evas_open ON public.station_accessibility USING gin (eva_nos) WHERE (closed_at IS NULL);

CREATE INDEX station_accessibility_stop_place ON public.station_accessibility USING btree (stop_place_id) WHERE (closed_at IS NULL);

CREATE INDEX station_equipment_equipment_no ON public.station_equipment USING btree (equipment_no) WHERE (equipment_no IS NOT NULL);

CREATE INDEX station_equipment_eva_open ON public.station_equipment USING btree (eva_no) WHERE (closed_at IS NULL);

CREATE INDEX station_equipment_stop_place_open ON public.station_equipment USING btree (stop_place_id) WHERE ((closed_at IS NULL) AND (stop_place_id IS NOT NULL));

CREATE UNIQUE INDEX station_equipment_ticks_pkey ON ONLY public.station_equipment_ticks USING btree (equipment_id, observed_at);

CREATE INDEX station_slugs_station ON public.station_slugs USING btree (station_no, assigned_at DESC);

CREATE INDEX stop_access_odbl_geom ON public.stop_access_odbl USING gist (geom) WHERE (closed_at IS NULL);

CREATE INDEX stop_times_deleted ON public.stop_times USING btree (deleted_at) WHERE (deleted_at IS NOT NULL);

CREATE INDEX stop_times_stop ON public.stop_times USING btree (gtfs_feed_key, stop_id, trip_id);

CREATE INDEX stop_times_stop_arr_tod ON public.stop_times USING btree (gtfs_feed_key, stop_id, mod((date_part('epoch'::text, arrival))::bigint, (86400)::bigint)) INCLUDE (arrival, trip_id, stop_sequence, drop_off_type) WHERE ((deleted_at IS NULL) AND (arrival IS NOT NULL));

CREATE INDEX stop_times_stop_tod ON public.stop_times USING btree (gtfs_feed_key, stop_id, mod((date_part('epoch'::text, departure))::bigint, (86400)::bigint)) INCLUDE (departure, trip_id, stop_sequence, pickup_type) WHERE ((deleted_at IS NULL) AND (departure IS NOT NULL));

CREATE INDEX stops_deleted ON public.stops USING btree (deleted_at) WHERE (deleted_at IS NOT NULL);

CREATE INDEX stops_geom_gist ON public.stops USING gist (geom);

CREATE INDEX stops_id_prefix ON public.stops USING btree (gtfs_feed_key, id text_pattern_ops);

CREATE INDEX stops_name_trgm ON public.stops USING gin (lower(name) public.gin_trgm_ops);

CREATE INDEX stops_parent ON public.stops USING btree (gtfs_feed_key, parent_id) WHERE (parent_id IS NOT NULL);

CREATE UNIQUE INDEX street_bay_ticks_pkey ON ONLY public.street_bay_ticks USING btree (bay_id, observed_at);

CREATE INDEX street_bays_geom_gist ON public.street_bays USING gist (geom) WHERE (closed_at IS NULL);

CREATE INDEX tmc_locations_motorway_gist ON public.tmc_locations USING gist (geom) WHERE ((tcd = 1) AND (road_number ~ '^A[1-9][0-9]{0,2}$'::text));

CREATE INDEX tmc_locations_motorway_points_gist ON public.tmc_locations USING gist (geom) WHERE ((cid = 58) AND (tabcd = 1) AND (road_number ~ '^A[1-9][0-9]{0,2}$'::text));

CREATE INDEX tmc_locations_road_number ON public.tmc_locations USING btree (road_number);

CREATE INDEX traffic_count_profiles_feed_month ON public.traffic_count_profiles USING btree (source_feed, month);

CREATE INDEX traffic_count_sites_geom_gist ON public.traffic_count_sites USING gist (geom) WHERE (closed_at IS NULL);

CREATE INDEX traffic_count_sites_heavy_stream ON public.traffic_count_sites USING btree (source_feed, heavy_stream) WHERE (closed_at IS NULL);

CREATE INDEX traffic_count_sites_vehicles_stream ON public.traffic_count_sites USING btree (source_feed, vehicles_stream) WHERE (closed_at IS NULL);

CREATE INDEX traffic_count_ticks_brin ON ONLY public.traffic_count_ticks USING brin (observed_at);

CREATE UNIQUE INDEX traffic_count_ticks_pkey ON ONLY public.traffic_count_ticks USING btree (site_id, measure, interval_start, observed_at);

CREATE INDEX transit_delays_brin ON ONLY public.transit_delays USING brin (observed_at);

CREATE INDEX transit_delays_kreis ON ONLY public.transit_delays USING btree ("left"(
CASE
    WHEN ((stop_id ~* '^de:[0-9]+(:|$)'::text) AND (length(split_part(stop_id, ':'::text, 2)) = ANY (ARRAY[2, 3, 5, 8]))) THEN split_part(stop_id, ':'::text, 2)
    ELSE NULL::text
END, 5), observed_at DESC);

CREATE INDEX transit_delays_region ON ONLY public.transit_delays USING btree ("left"(
CASE
    WHEN ((stop_id ~* '^de:[0-9]+(:|$)'::text) AND (length(split_part(stop_id, ':'::text, 2)) = ANY (ARRAY[2, 3, 5, 8]))) THEN split_part(stop_id, ':'::text, 2)
    ELSE NULL::text
END, 2), observed_at DESC);

CREATE INDEX transit_delays_stop ON ONLY public.transit_delays USING btree (stop_id, observed_at DESC);

CREATE INDEX transit_delays_trip ON ONLY public.transit_delays USING btree (trip_id, observed_at DESC);

CREATE INDEX transit_stop_modes_geom ON public.transit_stop_modes USING gist (geom);

CREATE UNIQUE INDEX transit_stop_modes_key ON public.transit_stop_modes USING btree (gtfs_feed_key, root_id);

CREATE INDEX translation_cache_last_used ON public.translation_cache USING btree (last_used_at);

CREATE INDEX trips_deleted ON public.trips USING btree (deleted_at) WHERE (deleted_at IS NOT NULL);

CREATE INDEX trips_route ON public.trips USING btree (gtfs_feed_key, route_id);

CREATE INDEX trips_service ON public.trips USING btree (gtfs_feed_key, service_id);

CREATE INDEX vbb_transit_delays_brin ON ONLY public.vbb_transit_delays USING brin (observed_at);

CREATE INDEX vbb_transit_delays_region ON ONLY public.vbb_transit_delays USING btree ("left"(
CASE
    WHEN ((stop_id ~* '^de:[0-9]+(:|$)'::text) AND (length(split_part(stop_id, ':'::text, 2)) = ANY (ARRAY[2, 3, 5, 8]))) THEN split_part(stop_id, ':'::text, 2)
    ELSE NULL::text
END, 2), observed_at DESC);

CREATE INDEX vbb_transit_delays_stop ON ONLY public.vbb_transit_delays USING btree (stop_id, observed_at DESC);

CREATE INDEX vbb_transit_delays_trip ON ONLY public.vbb_transit_delays USING btree (trip_id, observed_at DESC);

CREATE INDEX vbn_siri_et_calls_brin ON ONLY public.vbn_siri_et_calls USING brin (observed_at);

CREATE INDEX vbn_siri_et_calls_feed_ts ON ONLY public.vbn_siri_et_calls USING btree (feed_ts);

CREATE INDEX vbn_siri_et_calls_kreis ON ONLY public.vbn_siri_et_calls USING btree ("left"(
CASE
    WHEN ((stop_ref ~* '^de:[0-9]+(:|$)'::text) AND (length(split_part(stop_ref, ':'::text, 2)) = ANY (ARRAY[2, 3, 5, 8]))) THEN split_part(stop_ref, ':'::text, 2)
    ELSE NULL::text
END, 5), observed_at DESC);

CREATE INDEX vbn_siri_et_calls_region ON ONLY public.vbn_siri_et_calls USING btree ("left"(
CASE
    WHEN ((stop_ref ~* '^de:[0-9]+(:|$)'::text) AND (length(split_part(stop_ref, ':'::text, 2)) = ANY (ARRAY[2, 3, 5, 8]))) THEN split_part(stop_ref, ':'::text, 2)
    ELSE NULL::text
END, 2), observed_at DESC);

CREATE INDEX vbn_siri_et_calls_stop ON ONLY public.vbn_siri_et_calls USING btree (stop_ref, observed_at);

CREATE INDEX vrn_transit_delays_brin ON ONLY public.vrn_transit_delays USING brin (observed_at);

CREATE INDEX vrn_transit_delays_kreis ON ONLY public.vrn_transit_delays USING btree ("left"(
CASE
    WHEN ((stop_id ~* '^de:[0-9]+(:|$)'::text) AND (length(split_part(stop_id, ':'::text, 2)) = ANY (ARRAY[2, 3, 5, 8]))) THEN split_part(stop_id, ':'::text, 2)
    ELSE NULL::text
END, 5), observed_at DESC);

CREATE INDEX vrn_transit_delays_region ON ONLY public.vrn_transit_delays USING btree ("left"(
CASE
    WHEN ((stop_id ~* '^de:[0-9]+(:|$)'::text) AND (length(split_part(stop_id, ':'::text, 2)) = ANY (ARRAY[2, 3, 5, 8]))) THEN split_part(stop_id, ':'::text, 2)
    ELSE NULL::text
END, 2), observed_at DESC);

CREATE INDEX vrn_transit_delays_stop ON ONLY public.vrn_transit_delays USING btree (stop_id, observed_at DESC);

CREATE INDEX vrn_transit_delays_trip ON ONLY public.vrn_transit_delays USING btree (trip_id, observed_at DESC);

CREATE INDEX watch_events_by_watch ON public.watch_events USING btree (watch_id, id DESC);

CREATE INDEX watch_events_created ON public.watch_events USING btree (created_at);

CREATE INDEX watches_expires ON public.watches USING btree (expires_at);

CREATE INDEX watches_open_by_kind ON public.watches USING btree (kind, key) WHERE (stopped_at IS NULL);

CREATE INDEX watches_session ON public.watches USING btree (session_id);

CREATE INDEX weather_warnings_area_gist ON public.weather_warnings USING gist (area);

CREATE INDEX weather_warnings_deleted ON public.weather_warnings USING btree (deleted_at) WHERE (deleted_at IS NOT NULL);

CREATE INDEX weather_warnings_en_live_base ON public.weather_warnings_en USING btree (base_identifier, sent_at DESC) WHERE (closed_at IS NULL);

CREATE UNIQUE INDEX weather_warnings_en_live_key ON public.weather_warnings_en USING btree (source_feed, identifier, content_sha256) WHERE (closed_at IS NULL);

CREATE INDEX weather_warnings_en_live_sent ON public.weather_warnings_en USING btree (sent_at, valid_from) WHERE (closed_at IS NULL);

CREATE INDEX weather_warnings_live_cell ON public.weather_warnings USING btree (warncell_id, level DESC, valid_to) WHERE ((closed_at IS NULL) AND (deleted_at IS NULL));

CREATE INDEX weather_warnings_live_key ON public.weather_warnings USING btree (source_feed, identifier, warncell_id) WHERE ((closed_at IS NULL) AND (deleted_at IS NULL));

CREATE INDEX worker_boots_worker_booted ON public.worker_boots USING btree (worker, booted_at DESC);

CREATE STATISTICS public.charging_points_publishable ON COALESCE(confidentiality, 'noRestriction'::text) FROM public.charging_points;

CREATE STATISTICS public.charging_sites_publishable ON COALESCE(confidentiality, 'noRestriction'::text) FROM public.charging_sites;

CREATE TRIGGER budgets_audit AFTER INSERT OR DELETE OR UPDATE ON control.budgets FOR EACH ROW EXECUTE FUNCTION control.audit_change();

ALTER TABLE control.budgets ENABLE ALWAYS TRIGGER budgets_audit;

CREATE CONSTRAINT TRIGGER budgets_shape AFTER UPDATE OF ceiling ON control.budgets DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION control.check_budget_shape();

ALTER TABLE control.budgets ENABLE ALWAYS TRIGGER budgets_shape;

CREATE TRIGGER callers_audit AFTER INSERT OR DELETE OR UPDATE ON control.callers FOR EACH ROW EXECUTE FUNCTION control.audit_change();

ALTER TABLE control.callers ENABLE ALWAYS TRIGGER callers_audit;

CREATE TRIGGER changes_append_only BEFORE DELETE OR UPDATE ON control.changes FOR EACH ROW EXECUTE FUNCTION control.changes_append_only();

ALTER TABLE control.changes ENABLE ALWAYS TRIGGER changes_append_only;

CREATE TRIGGER shares_audit AFTER INSERT OR DELETE OR UPDATE ON control.shares FOR EACH ROW EXECUTE FUNCTION control.audit_change();

ALTER TABLE control.shares ENABLE ALWAYS TRIGGER shares_audit;

CREATE CONSTRAINT TRIGGER shares_shape AFTER INSERT OR DELETE OR UPDATE ON control.shares DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION control.check_budget_shape();

ALTER TABLE control.shares ENABLE ALWAYS TRIGGER shares_shape;

CREATE TRIGGER charging_sites_postcode BEFORE INSERT OR UPDATE OF postcode ON public.charging_sites FOR EACH ROW EXECUTE FUNCTION public.vf_postcode_normalise();

CREATE TRIGGER charging_status_runs_forget AFTER DELETE ON public.charging_point_status REFERENCING OLD TABLE AS old_ticks FOR EACH STATEMENT EXECUTE FUNCTION public.charging_status_runs_recompute();

CREATE TRIGGER charging_status_runs_note AFTER INSERT ON public.charging_point_status REFERENCING NEW TABLE AS new_ticks FOR EACH STATEMENT EXECUTE FUNCTION public.charging_status_runs_note();

CREATE TRIGGER charging_status_runs_restate AFTER UPDATE ON public.charging_point_status REFERENCING OLD TABLE AS old_ticks NEW TABLE AS new_ticks FOR EACH STATEMENT EXECUTE FUNCTION public.charging_status_runs_recompute();

CREATE TRIGGER feed_runs_feed_state_delete AFTER DELETE ON public.feed_runs REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION control.feed_state_after_change();

ALTER TABLE public.feed_runs ENABLE ALWAYS TRIGGER feed_runs_feed_state_delete;

CREATE TRIGGER feed_runs_feed_state_insert AFTER INSERT ON public.feed_runs REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION control.feed_state_after_change();

ALTER TABLE public.feed_runs ENABLE ALWAYS TRIGGER feed_runs_feed_state_insert;

CREATE TRIGGER feed_runs_feed_state_truncate AFTER TRUNCATE ON public.feed_runs FOR EACH STATEMENT EXECUTE FUNCTION control.feed_state_after_truncate();

ALTER TABLE public.feed_runs ENABLE ALWAYS TRIGGER feed_runs_feed_state_truncate;

CREATE TRIGGER feed_runs_feed_state_update AFTER UPDATE ON public.feed_runs REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION control.feed_state_after_change();

ALTER TABLE public.feed_runs ENABLE ALWAYS TRIGGER feed_runs_feed_state_update;

CREATE TRIGGER feed_versions_bump_insert AFTER INSERT ON public.feed_runs FOR EACH ROW WHEN ((new.finished_at IS NOT NULL)) EXECUTE FUNCTION public.feed_versions_bump();

CREATE TRIGGER feed_versions_bump_insert AFTER INSERT ON public.ingest_runs FOR EACH ROW WHEN ((new.finished_at IS NOT NULL)) EXECUTE FUNCTION public.feed_versions_bump();

CREATE TRIGGER feed_versions_bump_update AFTER UPDATE OF finished_at, status, items_seen ON public.feed_runs FOR EACH ROW WHEN (((new.finished_at IS NOT NULL) AND ((old.finished_at IS DISTINCT FROM new.finished_at) OR (old.status IS DISTINCT FROM new.status) OR (old.items_seen IS DISTINCT FROM new.items_seen)))) EXECUTE FUNCTION public.feed_versions_bump();

CREATE TRIGGER feed_versions_bump_update AFTER UPDATE OF finished_at, status ON public.ingest_runs FOR EACH ROW WHEN (((new.finished_at IS NOT NULL) AND ((old.finished_at IS DISTINCT FROM new.finished_at) OR (old.status IS DISTINCT FROM new.status)))) EXECUTE FUNCTION public.feed_versions_bump();

CREATE TRIGGER feed_versions_forget AFTER DELETE ON public.feed_runs REFERENCING OLD TABLE AS old_runs FOR EACH STATEMENT EXECUTE FUNCTION public.feed_versions_forget();

CREATE TRIGGER fuel_stations_land BEFORE INSERT OR UPDATE OF geom ON public.fuel_stations FOR EACH ROW EXECUTE FUNCTION public.fuel_stations_set_land();

CREATE TRIGGER fuel_stations_postcode BEFORE INSERT OR UPDATE OF postcode ON public.fuel_stations FOR EACH ROW EXECUTE FUNCTION public.vf_postcode_normalise();

CREATE TRIGGER ingest_runs_feed_state_delete AFTER DELETE ON public.ingest_runs REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION control.feed_state_after_change();

ALTER TABLE public.ingest_runs ENABLE ALWAYS TRIGGER ingest_runs_feed_state_delete;

CREATE TRIGGER ingest_runs_feed_state_insert AFTER INSERT ON public.ingest_runs REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION control.feed_state_after_change();

ALTER TABLE public.ingest_runs ENABLE ALWAYS TRIGGER ingest_runs_feed_state_insert;

CREATE TRIGGER ingest_runs_feed_state_truncate AFTER TRUNCATE ON public.ingest_runs FOR EACH STATEMENT EXECUTE FUNCTION control.feed_state_after_truncate();

ALTER TABLE public.ingest_runs ENABLE ALWAYS TRIGGER ingest_runs_feed_state_truncate;

CREATE TRIGGER ingest_runs_feed_state_update AFTER UPDATE ON public.ingest_runs REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION control.feed_state_after_change();

ALTER TABLE public.ingest_runs ENABLE ALWAYS TRIGGER ingest_runs_feed_state_update;

CREATE TRIGGER lez_zones_overlaps_insert AFTER INSERT ON public.lez_zones FOR EACH ROW EXECUTE FUNCTION public.lez_zones_overlaps_trigger();

CREATE TRIGGER lez_zones_overlaps_update AFTER UPDATE OF geom, role, closed_at, source_feed, zone_id ON public.lez_zones FOR EACH ROW EXECUTE FUNCTION public.lez_zones_overlaps_trigger();

CREATE TRIGGER ops_audit_append_only BEFORE DELETE OR UPDATE ON public.ops_audit FOR EACH ROW EXECUTE FUNCTION public.ops_audit_append_only();

CREATE TRIGGER ops_passkeys_cap BEFORE INSERT ON public.ops_passkeys FOR EACH ROW EXECUTE FUNCTION public.ops_passkeys_cap();

CREATE TRIGGER ops_passkeys_counter BEFORE UPDATE ON public.ops_passkeys FOR EACH ROW EXECUTE FUNCTION public.ops_passkeys_counter();

CREATE TRIGGER ops_requests_rate_limit BEFORE INSERT ON public.ops_requests FOR EACH ROW EXECUTE FUNCTION public.ops_requests_rate_limit();

CREATE TRIGGER ops_requests_source_guard BEFORE INSERT ON public.ops_requests FOR EACH ROW EXECUTE FUNCTION public.ops_requests_source_guard();

CREATE TRIGGER place_slugs_frozen BEFORE DELETE OR UPDATE ON public.place_slugs FOR EACH ROW EXECUTE FUNCTION public.place_slugs_frozen();

CREATE TRIGGER road_events_suspended BEFORE INSERT OR UPDATE OF payload ON public.road_events FOR EACH ROW EXECUTE FUNCTION public.road_events_note_suspended();

CREATE TRIGGER runtime_config_source_bounds BEFORE INSERT OR UPDATE ON public.runtime_config FOR EACH ROW EXECUTE FUNCTION public.runtime_config_source_bounds();

CREATE TRIGGER station_slugs_frozen BEFORE DELETE OR UPDATE ON public.station_slugs FOR EACH ROW EXECUTE FUNCTION public.station_slugs_frozen();

CREATE TRIGGER street_bays_postcode BEFORE INSERT OR UPDATE OF postcode ON public.street_bays FOR EACH ROW EXECUTE FUNCTION public.vf_postcode_normalise();

CREATE TRIGGER watch_events_notify_insert AFTER INSERT ON public.watch_events FOR EACH ROW EXECUTE FUNCTION public.watch_events_notify();

CREATE TRIGGER watches_limit_per_session BEFORE INSERT ON public.watches FOR EACH ROW EXECUTE FUNCTION public.watches_enforce_session_limit();

ALTER TABLE ONLY control.budget_state
    ADD CONSTRAINT budget_state_budget_key_fkey FOREIGN KEY (budget_key) REFERENCES control.budgets(budget_key);

ALTER TABLE ONLY control.providers
    ADD CONSTRAINT providers_budget_key_fkey FOREIGN KEY (budget_key) REFERENCES control.budgets(budget_key);

ALTER TABLE ONLY control.shares
    ADD CONSTRAINT shares_budget_key_fkey FOREIGN KEY (budget_key) REFERENCES control.budgets(budget_key);

ALTER TABLE ONLY control.shares
    ADD CONSTRAINT shares_caller_fkey FOREIGN KEY (caller) REFERENCES control.callers(caller);

ALTER TABLE ONLY ingestor.run_errors
    ADD CONSTRAINT run_errors_run_id_fkey FOREIGN KEY (run_id) REFERENCES ingestor.runs(id) ON DELETE CASCADE;

ALTER TABLE ONLY ingestor.run_errors
    ADD CONSTRAINT run_errors_source_id_fkey FOREIGN KEY (source_id) REFERENCES ingestor.sources(id) ON UPDATE CASCADE;

ALTER TABLE ONLY ingestor.runs
    ADD CONSTRAINT runs_source_id_fkey FOREIGN KEY (source_id) REFERENCES ingestor.sources(id) ON UPDATE CASCADE;

ALTER TABLE ONLY ingestor.source_state
    ADD CONSTRAINT source_state_source_id_fkey FOREIGN KEY (source_id) REFERENCES ingestor.sources(id) ON UPDATE CASCADE;

ALTER TABLE ONLY ingestor.sources
    ADD CONSTRAINT sources_unit_fkey FOREIGN KEY (unit) REFERENCES ingestor.units(name) ON UPDATE CASCADE;

ALTER TABLE ONLY public.ags_regions
    ADD CONSTRAINT ags_regions_parent_ags_fkey FOREIGN KEY (parent_ags) REFERENCES public.ags_regions(ags);

ALTER TABLE ONLY public.charging_points
    ADD CONSTRAINT charging_points_source_feed_site_id_fkey FOREIGN KEY (source_feed, site_id) REFERENCES public.charging_sites(source_feed, site_id);

ALTER TABLE ONLY public.city_traffic_state
    ADD CONSTRAINT city_traffic_state_segment_id_fkey FOREIGN KEY (segment_id) REFERENCES public.city_traffic_segments(id);

ALTER TABLE ONLY public.fuel_price_latest
    ADD CONSTRAINT fuel_price_latest_product_fkey FOREIGN KEY (product) REFERENCES public.fuel_products(code);

ALTER TABLE ONLY public.fuel_price_latest
    ADD CONSTRAINT fuel_price_latest_station_id_fkey FOREIGN KEY (station_id) REFERENCES public.fuel_stations(id) ON DELETE CASCADE;

ALTER TABLE public.fuel_prices
    ADD CONSTRAINT fuel_prices_product_fkey FOREIGN KEY (product) REFERENCES public.fuel_products(code);

ALTER TABLE ONLY public.fuel_sample_strata
    ADD CONSTRAINT fuel_sample_strata_draw_id_fkey FOREIGN KEY (draw_id) REFERENCES public.fuel_sample_draws(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.fuel_station_watch
    ADD CONSTRAINT fuel_station_watch_sample_draw_id_fkey FOREIGN KEY (sample_draw_id) REFERENCES public.fuel_sample_draws(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.fuel_station_watch
    ADD CONSTRAINT fuel_station_watch_station_id_fkey FOREIGN KEY (station_id) REFERENCES public.fuel_stations(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.lez_zone_overlaps
    ADD CONSTRAINT lez_zone_overlaps_other_fk FOREIGN KEY (other_feed, other_zone_id) REFERENCES public.lez_zones(source_feed, zone_id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.lez_zone_overlaps
    ADD CONSTRAINT lez_zone_overlaps_zone_fk FOREIGN KEY (source_feed, zone_id) REFERENCES public.lez_zones(source_feed, zone_id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.parking_occupancy_odbl
    ADD CONSTRAINT parking_occupancy_odbl_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.parking_facilities_odbl(id);

ALTER TABLE ONLY public.road_event_locations
    ADD CONSTRAINT road_event_locations_road_event_id_fkey FOREIGN KEY (road_event_id) REFERENCES public.road_events(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.search_console_weekly_parts
    ADD CONSTRAINT search_console_weekly_parts_week_fkey FOREIGN KEY (week) REFERENCES public.search_console_weekly(week) ON DELETE CASCADE;

ALTER TABLE ONLY public.site_visits_devices
    ADD CONSTRAINT site_visits_devices_day_fkey FOREIGN KEY (day) REFERENCES public.site_visits_daily(day) ON DELETE CASCADE;

ALTER TABLE ONLY public.site_visits_entries
    ADD CONSTRAINT site_visits_entries_day_fkey FOREIGN KEY (day) REFERENCES public.site_visits_daily(day) ON DELETE CASCADE;

ALTER TABLE ONLY public.site_visits_entry_referrers
    ADD CONSTRAINT site_visits_entry_referrers_day_fkey FOREIGN KEY (day) REFERENCES public.site_visits_daily(day) ON DELETE CASCADE;

ALTER TABLE ONLY public.site_visits_hourly
    ADD CONSTRAINT site_visits_hourly_day_fkey FOREIGN KEY (day) REFERENCES public.site_visits_daily(day) ON DELETE CASCADE;

ALTER TABLE ONLY public.site_visits_pages_per_visit
    ADD CONSTRAINT site_visits_pages_per_visit_day_fkey FOREIGN KEY (day) REFERENCES public.site_visits_daily(day) ON DELETE CASCADE;

ALTER TABLE ONLY public.site_visits_referrers
    ADD CONSTRAINT site_visits_referrers_day_fkey FOREIGN KEY (day) REFERENCES public.site_visits_daily(day) ON DELETE CASCADE;

ALTER TABLE ONLY public.site_visits_routes
    ADD CONSTRAINT site_visits_routes_day_fkey FOREIGN KEY (day) REFERENCES public.site_visits_daily(day) ON DELETE CASCADE;

ALTER TABLE ONLY public.site_visits_search_engines
    ADD CONSTRAINT site_visits_search_engines_day_fkey FOREIGN KEY (day) REFERENCES public.site_visits_daily(day) ON DELETE CASCADE;

ALTER TABLE ONLY public.station_slugs
    ADD CONSTRAINT station_slugs_station_no_fkey FOREIGN KEY (station_no) REFERENCES public.db_stations(station_no);

ALTER TABLE ONLY public.traffic_count_latest
    ADD CONSTRAINT traffic_count_latest_site_id_fkey FOREIGN KEY (site_id) REFERENCES public.traffic_count_sites(id);

ALTER TABLE ONLY public.traffic_count_profiles
    ADD CONSTRAINT traffic_count_profiles_site_id_fkey FOREIGN KEY (site_id) REFERENCES public.traffic_count_sites(id);

ALTER TABLE ONLY public.watch_events
    ADD CONSTRAINT watch_events_watch_id_fkey FOREIGN KEY (watch_id) REFERENCES public.watches(id) ON DELETE CASCADE;

ALTER TABLE domains.road_works ENABLE ROW LEVEL SECURITY;

CREATE POLICY road_works_own_insert ON domains.road_works FOR INSERT TO viafrei_ingestor WITH CHECK (((source_id = current_setting('viafrei.source_id'::text, true)) AND (EXISTS ( SELECT 1
   FROM ingestor.sources s
  WHERE ((s.id = road_works.source_id) AND (s.domain = 'road_works'::text))))));

CREATE POLICY road_works_own_update ON domains.road_works FOR UPDATE TO viafrei_ingestor USING ((source_id = current_setting('viafrei.source_id'::text, true))) WITH CHECK ((source_id = current_setting('viafrei.source_id'::text, true)));

CREATE POLICY road_works_read ON domains.road_works FOR SELECT USING (true);

ALTER TABLE domains.route_recommendations ENABLE ROW LEVEL SECURITY;

CREATE POLICY route_recommendations_own_insert ON domains.route_recommendations FOR INSERT TO viafrei_ingestor WITH CHECK (((source_id = current_setting('viafrei.source_id'::text, true)) AND (EXISTS ( SELECT 1
   FROM ingestor.sources s
  WHERE ((s.id = route_recommendations.source_id) AND (s.domain = 'route_recommendations'::text))))));

CREATE POLICY route_recommendations_own_update ON domains.route_recommendations FOR UPDATE TO viafrei_ingestor USING ((source_id = current_setting('viafrei.source_id'::text, true))) WITH CHECK ((source_id = current_setting('viafrei.source_id'::text, true)));

CREATE POLICY route_recommendations_read ON domains.route_recommendations FOR SELECT USING (true);

ALTER TABLE domains.speed_cameras ENABLE ROW LEVEL SECURITY;

CREATE POLICY speed_cameras_own_insert ON domains.speed_cameras FOR INSERT TO viafrei_ingestor WITH CHECK (((source_id = current_setting('viafrei.source_id'::text, true)) AND (EXISTS ( SELECT 1
   FROM ingestor.sources s
  WHERE ((s.id = speed_cameras.source_id) AND (s.domain = 'speed_cameras'::text))))));

CREATE POLICY speed_cameras_own_update ON domains.speed_cameras FOR UPDATE TO viafrei_ingestor USING ((source_id = current_setting('viafrei.source_id'::text, true))) WITH CHECK ((source_id = current_setting('viafrei.source_id'::text, true)));

CREATE POLICY speed_cameras_read ON domains.speed_cameras FOR SELECT USING (true);

ALTER TABLE domains.transit_agencies_odbl ENABLE ROW LEVEL SECURITY;

CREATE POLICY transit_agencies_odbl_own_insert ON domains.transit_agencies_odbl FOR INSERT TO viafrei_ingestor WITH CHECK (((source_id = current_setting('viafrei.source_id'::text, true)) AND (EXISTS ( SELECT 1
   FROM ingestor.sources s
  WHERE ((s.id = transit_agencies_odbl.source_id) AND (s.domain = 'transit_agencies_odbl'::text))))));

CREATE POLICY transit_agencies_odbl_own_update ON domains.transit_agencies_odbl FOR UPDATE TO viafrei_ingestor USING ((source_id = current_setting('viafrei.source_id'::text, true))) WITH CHECK ((source_id = current_setting('viafrei.source_id'::text, true)));

CREATE POLICY transit_agencies_odbl_read ON domains.transit_agencies_odbl FOR SELECT USING (true);

ALTER TABLE domains.transit_routes_odbl ENABLE ROW LEVEL SECURITY;

CREATE POLICY transit_routes_odbl_own_insert ON domains.transit_routes_odbl FOR INSERT TO viafrei_ingestor WITH CHECK (((source_id = current_setting('viafrei.source_id'::text, true)) AND (EXISTS ( SELECT 1
   FROM ingestor.sources s
  WHERE ((s.id = transit_routes_odbl.source_id) AND (s.domain = 'transit_routes_odbl'::text))))));

CREATE POLICY transit_routes_odbl_own_update ON domains.transit_routes_odbl FOR UPDATE TO viafrei_ingestor USING ((source_id = current_setting('viafrei.source_id'::text, true))) WITH CHECK ((source_id = current_setting('viafrei.source_id'::text, true)));

CREATE POLICY transit_routes_odbl_read ON domains.transit_routes_odbl FOR SELECT USING (true);

ALTER TABLE domains.transit_service_dates_odbl ENABLE ROW LEVEL SECURITY;

CREATE POLICY transit_service_dates_odbl_own_insert ON domains.transit_service_dates_odbl FOR INSERT TO viafrei_ingestor WITH CHECK (((source_id = current_setting('viafrei.source_id'::text, true)) AND (EXISTS ( SELECT 1
   FROM ingestor.sources s
  WHERE ((s.id = transit_service_dates_odbl.source_id) AND (s.domain = 'transit_service_dates_odbl'::text))))));

CREATE POLICY transit_service_dates_odbl_own_update ON domains.transit_service_dates_odbl FOR UPDATE TO viafrei_ingestor USING ((source_id = current_setting('viafrei.source_id'::text, true))) WITH CHECK ((source_id = current_setting('viafrei.source_id'::text, true)));

CREATE POLICY transit_service_dates_odbl_read ON domains.transit_service_dates_odbl FOR SELECT USING (true);

ALTER TABLE domains.transit_stop_times_odbl ENABLE ROW LEVEL SECURITY;

CREATE POLICY transit_stop_times_odbl_own_insert ON domains.transit_stop_times_odbl FOR INSERT TO viafrei_ingestor WITH CHECK (((source_id = current_setting('viafrei.source_id'::text, true)) AND (EXISTS ( SELECT 1
   FROM ingestor.sources s
  WHERE ((s.id = transit_stop_times_odbl.source_id) AND (s.domain = 'transit_stop_times_odbl'::text))))));

CREATE POLICY transit_stop_times_odbl_own_update ON domains.transit_stop_times_odbl FOR UPDATE TO viafrei_ingestor USING ((source_id = current_setting('viafrei.source_id'::text, true))) WITH CHECK ((source_id = current_setting('viafrei.source_id'::text, true)));

CREATE POLICY transit_stop_times_odbl_read ON domains.transit_stop_times_odbl FOR SELECT USING (true);

ALTER TABLE domains.transit_stops_odbl ENABLE ROW LEVEL SECURITY;

CREATE POLICY transit_stops_odbl_own_insert ON domains.transit_stops_odbl FOR INSERT TO viafrei_ingestor WITH CHECK (((source_id = current_setting('viafrei.source_id'::text, true)) AND (EXISTS ( SELECT 1
   FROM ingestor.sources s
  WHERE ((s.id = transit_stops_odbl.source_id) AND (s.domain = 'transit_stops_odbl'::text))))));

CREATE POLICY transit_stops_odbl_own_update ON domains.transit_stops_odbl FOR UPDATE TO viafrei_ingestor USING ((source_id = current_setting('viafrei.source_id'::text, true))) WITH CHECK ((source_id = current_setting('viafrei.source_id'::text, true)));

CREATE POLICY transit_stops_odbl_read ON domains.transit_stops_odbl FOR SELECT USING (true);

ALTER TABLE domains.transit_trip_updates_odbl ENABLE ROW LEVEL SECURITY;

CREATE POLICY transit_trip_updates_odbl_own_insert ON domains.transit_trip_updates_odbl FOR INSERT TO viafrei_ingestor WITH CHECK (((source_id = current_setting('viafrei.source_id'::text, true)) AND (EXISTS ( SELECT 1
   FROM ingestor.sources s
  WHERE ((s.id = transit_trip_updates_odbl.source_id) AND (s.domain = 'transit_trip_updates_odbl'::text))))));

CREATE POLICY transit_trip_updates_odbl_own_update ON domains.transit_trip_updates_odbl FOR UPDATE TO viafrei_ingestor USING ((source_id = current_setting('viafrei.source_id'::text, true))) WITH CHECK ((source_id = current_setting('viafrei.source_id'::text, true)));

CREATE POLICY transit_trip_updates_odbl_read ON domains.transit_trip_updates_odbl FOR SELECT USING (true);

ALTER TABLE domains.transit_trips_odbl ENABLE ROW LEVEL SECURITY;

CREATE POLICY transit_trips_odbl_own_insert ON domains.transit_trips_odbl FOR INSERT TO viafrei_ingestor WITH CHECK (((source_id = current_setting('viafrei.source_id'::text, true)) AND (EXISTS ( SELECT 1
   FROM ingestor.sources s
  WHERE ((s.id = transit_trips_odbl.source_id) AND (s.domain = 'transit_trips_odbl'::text))))));

CREATE POLICY transit_trips_odbl_own_update ON domains.transit_trips_odbl FOR UPDATE TO viafrei_ingestor USING ((source_id = current_setting('viafrei.source_id'::text, true))) WITH CHECK ((source_id = current_setting('viafrei.source_id'::text, true)));

CREATE POLICY transit_trips_odbl_read ON domains.transit_trips_odbl FOR SELECT USING (true);

GRANT USAGE ON SCHEMA control TO viafrei_mcp;
GRANT USAGE ON SCHEMA control TO viafrei_digest;
GRANT USAGE ON SCHEMA control TO viafrei_status;
GRANT USAGE ON SCHEMA control TO viafrei_ops;

GRANT USAGE ON SCHEMA domains TO viafrei_ingestor;

GRANT USAGE ON SCHEMA ingestor TO viafrei_ingestor;

GRANT USAGE ON SCHEMA public TO viafrei_status;
GRANT USAGE ON SCHEMA public TO viafrei_digest;
GRANT USAGE ON SCHEMA public TO viafrei_mcp;
GRANT USAGE ON SCHEMA public TO viafrei_ops;
GRANT USAGE ON SCHEMA public TO viafrei_translate;

REVOKE ALL ON FUNCTION control.admit(p_provider text, p_caller text, p_subject text) FROM PUBLIC;
GRANT ALL ON FUNCTION control.admit(p_provider text, p_caller text, p_subject text) TO viafrei_mcp;

REVOKE ALL ON FUNCTION control.audit_change() FROM PUBLIC;

REVOKE ALL ON FUNCTION control.bucket_width(p_window_s integer, p_burst_window_s integer) FROM PUBLIC;

REVOKE ALL ON FUNCTION control.changes_append_only() FROM PUBLIC;

REVOKE ALL ON FUNCTION control.check_budget_shape() FROM PUBLIC;

REVOKE ALL ON FUNCTION control.feed_state_after_change() FROM PUBLIC;

REVOKE ALL ON FUNCTION control.feed_state_after_truncate() FROM PUBLIC;

REVOKE ALL ON FUNCTION control.fit_shares(p_budget_key text) FROM PUBLIC;

REVOKE ALL ON FUNCTION control.fold_feed_state(p_ledger text, p_facts control.run_fact[]) FROM PUBLIC;

REVOKE ALL ON FUNCTION control.hold(p_provider text, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION control.hold(p_provider text, p_reason text) TO viafrei_mcp;

REVOKE ALL ON FUNCTION control.publish_terms(p jsonb) FROM PUBLIC;

REVOKE ALL ON FUNCTION control.recompute_feed_state(p_ledger text, p_keys text[]) FROM PUBLIC;

REVOKE ALL ON FUNCTION control.release(p_provider text, p_caller text, p_token text) FROM PUBLIC;

REVOKE ALL ON FUNCTION control.rollup_refresh(p_from timestamp with time zone) FROM PUBLIC;

REVOKE ALL ON FUNCTION control.set_budget(p_budget_key text, p_caller text, p_field text, p_value numeric, p_actor text, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION control.set_budget(p_budget_key text, p_caller text, p_field text, p_value numeric, p_actor text, p_reason text) TO viafrei_ops;

REVOKE ALL ON FUNCTION control.want(p_provider text) FROM PUBLIC;
GRANT ALL ON FUNCTION control.want(p_provider text) TO viafrei_mcp;

REVOKE ALL ON FUNCTION ingestor.project_run(p_run_id bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION ingestor.project_run(p_run_id bigint) TO viafrei_ingestor;

REVOKE ALL ON FUNCTION ingestor.register_feed(p_feed_key text, p_display_name text, p_provider text, p_licence_id text, p_licence_label text, p_attribution text, p_cadence_s integer, p_min_interval_s integer, p_enabled boolean, p_registry_version text) FROM PUBLIC;
GRANT ALL ON FUNCTION ingestor.register_feed(p_feed_key text, p_display_name text, p_provider text, p_licence_id text, p_licence_label text, p_attribution text, p_cadence_s integer, p_min_interval_s integer, p_enabled boolean, p_registry_version text) TO viafrei_ingestor;

REVOKE ALL ON FUNCTION ingestor.taken_feed_keys(p_ids text[]) FROM PUBLIC;
GRANT ALL ON FUNCTION ingestor.taken_feed_keys(p_ids text[]) TO viafrei_ingestor;

REVOKE ALL ON FUNCTION public.fuel_warm_cadence(p_city_population_min integer, p_city_radius_min_m double precision, p_city_radius_max_m double precision, p_city_radius_per_sqrt_thousand_m double precision, p_motorway_corridor_m double precision, p_failure_threshold integer, p_days integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.fuel_warm_cadence(p_city_population_min integer, p_city_radius_min_m double precision, p_city_radius_max_m double precision, p_city_radius_per_sqrt_thousand_m double precision, p_motorway_corridor_m double precision, p_failure_threshold integer, p_days integer) TO viafrei_mcp;

REVOKE ALL ON FUNCTION public.ops_audit_forget_ips() FROM PUBLIC;

REVOKE ALL ON FUNCTION public.pg_stat_statements(showtext boolean, OUT userid oid, OUT dbid oid, OUT toplevel boolean, OUT queryid bigint, OUT query text, OUT plans bigint, OUT total_plan_time double precision, OUT min_plan_time double precision, OUT max_plan_time double precision, OUT mean_plan_time double precision, OUT stddev_plan_time double precision, OUT calls bigint, OUT total_exec_time double precision, OUT min_exec_time double precision, OUT max_exec_time double precision, OUT mean_exec_time double precision, OUT stddev_exec_time double precision, OUT rows bigint, OUT shared_blks_hit bigint, OUT shared_blks_read bigint, OUT shared_blks_dirtied bigint, OUT shared_blks_written bigint, OUT local_blks_hit bigint, OUT local_blks_read bigint, OUT local_blks_dirtied bigint, OUT local_blks_written bigint, OUT temp_blks_read bigint, OUT temp_blks_written bigint, OUT blk_read_time double precision, OUT blk_write_time double precision, OUT temp_blk_read_time double precision, OUT temp_blk_write_time double precision, OUT wal_records bigint, OUT wal_fpi bigint, OUT wal_bytes numeric, OUT jit_functions bigint, OUT jit_generation_time double precision, OUT jit_inlining_count bigint, OUT jit_inlining_time double precision, OUT jit_optimization_count bigint, OUT jit_optimization_time double precision, OUT jit_emission_count bigint, OUT jit_emission_time double precision) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.weather_warning_english(german_id bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.weather_warning_english(german_id bigint) TO viafrei_mcp;
GRANT ALL ON FUNCTION public.weather_warning_english(german_id bigint) TO viafrei_digest;

GRANT SELECT ON TABLE control.budgets TO viafrei_status;

GRANT SELECT(budget_key) ON TABLE control.budgets TO viafrei_mcp;
GRANT SELECT(budget_key) ON TABLE control.budgets TO viafrei_digest;

GRANT SELECT(ceiling) ON TABLE control.budgets TO viafrei_mcp;

GRANT SELECT(spacing_ms) ON TABLE control.budgets TO viafrei_mcp;
GRANT SELECT(spacing_ms) ON TABLE control.budgets TO viafrei_digest;

GRANT SELECT ON TABLE public.feed_catalog TO viafrei_status;
GRANT SELECT ON TABLE public.feed_catalog TO viafrei_mcp;

GRANT SELECT ON TABLE public.runtime_config TO viafrei_status;
GRANT SELECT ON TABLE public.runtime_config TO viafrei_ops;
GRANT SELECT ON TABLE public.runtime_config TO viafrei_mcp;
GRANT SELECT ON TABLE public.runtime_config TO viafrei_digest;

GRANT INSERT(key) ON TABLE public.runtime_config TO viafrei_ops;

GRANT INSERT(value),UPDATE(value) ON TABLE public.runtime_config TO viafrei_ops;

GRANT INSERT(changed_by),UPDATE(changed_by) ON TABLE public.runtime_config TO viafrei_ops;

GRANT INSERT(changed_at),UPDATE(changed_at) ON TABLE public.runtime_config TO viafrei_ops;

GRANT INSERT(reason),UPDATE(reason) ON TABLE public.runtime_config TO viafrei_ops;

GRANT SELECT ON TABLE public.source_schedule TO viafrei_ops;

GRANT SELECT ON TABLE control.data_status TO viafrei_mcp;
GRANT SELECT ON TABLE control.data_status TO viafrei_digest;
GRANT SELECT ON TABLE control.data_status TO viafrei_status;

GRANT SELECT ON TABLE control.shares TO viafrei_status;

GRANT SELECT(budget_key) ON TABLE control.shares TO viafrei_mcp;
GRANT SELECT(budget_key) ON TABLE control.shares TO viafrei_digest;

GRANT SELECT(caller) ON TABLE control.shares TO viafrei_mcp;
GRANT SELECT(caller) ON TABLE control.shares TO viafrei_digest;

GRANT SELECT(cap) ON TABLE control.shares TO viafrei_mcp;
GRANT SELECT(cap) ON TABLE control.shares TO viafrei_digest;

GRANT SELECT ON TABLE control.usage_hourly TO viafrei_status;

GRANT SELECT,INSERT,UPDATE ON TABLE domains.road_works TO viafrei_ingestor;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE ingestor.sources TO viafrei_ingestor;

GRANT SELECT ON TABLE domains.road_works_merged TO viafrei_ingestor;

GRANT SELECT,INSERT,UPDATE ON TABLE domains.route_recommendations TO viafrei_ingestor;

GRANT SELECT ON TABLE domains.route_recommendations_merged TO viafrei_ingestor;

GRANT SELECT,INSERT,UPDATE ON TABLE domains.speed_cameras TO viafrei_ingestor;

GRANT SELECT ON TABLE domains.speed_cameras_merged TO viafrei_ingestor;

GRANT SELECT,INSERT,UPDATE ON TABLE domains.transit_agencies_odbl TO viafrei_ingestor;

GRANT SELECT ON TABLE domains.transit_agencies_odbl_merged TO viafrei_ingestor;

GRANT SELECT,INSERT,UPDATE ON TABLE domains.transit_routes_odbl TO viafrei_ingestor;

GRANT SELECT ON TABLE domains.transit_routes_odbl_merged TO viafrei_ingestor;

GRANT SELECT,INSERT,UPDATE ON TABLE domains.transit_service_dates_odbl TO viafrei_ingestor;

GRANT SELECT ON TABLE domains.transit_service_dates_odbl_merged TO viafrei_ingestor;

GRANT SELECT,INSERT,UPDATE ON TABLE domains.transit_stop_times_odbl TO viafrei_ingestor;

GRANT SELECT ON TABLE domains.transit_stop_times_odbl_merged TO viafrei_ingestor;

GRANT SELECT,INSERT,UPDATE ON TABLE domains.transit_stops_odbl TO viafrei_ingestor;

GRANT SELECT ON TABLE domains.transit_stops_odbl_merged TO viafrei_ingestor;

GRANT SELECT,INSERT,UPDATE ON TABLE domains.transit_trip_updates_odbl TO viafrei_ingestor;

GRANT SELECT ON TABLE domains.transit_trip_updates_odbl_merged TO viafrei_ingestor;

GRANT SELECT,INSERT,UPDATE ON TABLE domains.transit_trips_odbl TO viafrei_ingestor;

GRANT SELECT ON TABLE domains.transit_trips_odbl_merged TO viafrei_ingestor;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE ingestor.limit_claims TO viafrei_ingestor;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE ingestor.run_errors TO viafrei_ingestor;

GRANT SELECT,DELETE ON TABLE ingestor.runs TO viafrei_ingestor;

GRANT INSERT(source_id) ON TABLE ingestor.runs TO viafrei_ingestor;

GRANT INSERT(unit) ON TABLE ingestor.runs TO viafrei_ingestor;

GRANT INSERT(pod) ON TABLE ingestor.runs TO viafrei_ingestor;

GRANT INSERT(config_sha256) ON TABLE ingestor.runs TO viafrei_ingestor;

GRANT INSERT(scheduled_at) ON TABLE ingestor.runs TO viafrei_ingestor;

GRANT UPDATE(finished_at) ON TABLE ingestor.runs TO viafrei_ingestor;

GRANT UPDATE(duration_ms) ON TABLE ingestor.runs TO viafrei_ingestor;

GRANT INSERT(status),UPDATE(status) ON TABLE ingestor.runs TO viafrei_ingestor;

GRANT UPDATE(fetched) ON TABLE ingestor.runs TO viafrei_ingestor;

GRANT UPDATE(parsed) ON TABLE ingestor.runs TO viafrei_ingestor;

GRANT UPDATE(inserted) ON TABLE ingestor.runs TO viafrei_ingestor;

GRANT UPDATE(updated) ON TABLE ingestor.runs TO viafrei_ingestor;

GRANT UPDATE(closed) ON TABLE ingestor.runs TO viafrei_ingestor;

GRANT UPDATE(rejected) ON TABLE ingestor.runs TO viafrei_ingestor;

GRANT UPDATE(requests) ON TABLE ingestor.runs TO viafrei_ingestor;

GRANT UPDATE(bytes) ON TABLE ingestor.runs TO viafrei_ingestor;

GRANT UPDATE(http_status) ON TABLE ingestor.runs TO viafrei_ingestor;

GRANT UPDATE(error_class) ON TABLE ingestor.runs TO viafrei_ingestor;

GRANT UPDATE(error_stage) ON TABLE ingestor.runs TO viafrei_ingestor;

GRANT UPDATE(error_message) ON TABLE ingestor.runs TO viafrei_ingestor;

GRANT UPDATE(error_stack) ON TABLE ingestor.runs TO viafrei_ingestor;

GRANT INSERT(attempt) ON TABLE ingestor.runs TO viafrei_ingestor;

GRANT UPDATE(mem_peak_bytes) ON TABLE ingestor.runs TO viafrei_ingestor;

GRANT UPDATE(raw_path) ON TABLE ingestor.runs TO viafrei_ingestor;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE ingestor.source_state TO viafrei_ingestor;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE ingestor.units TO viafrei_ingestor;

GRANT SELECT ON TABLE public.ags_regions TO viafrei_mcp;

GRANT SELECT ON TABLE public.alarm_episodes TO viafrei_status;

GRANT SELECT ON TABLE public.autobahn_events TO viafrei_digest;
GRANT SELECT ON TABLE public.autobahn_events TO viafrei_mcp;

GRANT SELECT ON TABLE public.autobahn_jam_hours TO viafrei_digest;
GRANT SELECT ON TABLE public.autobahn_jam_hours TO viafrei_mcp;

GRANT SELECT ON TABLE public.autobahn_roads TO viafrei_mcp;

GRANT SELECT ON TABLE public.bfrk_stops TO viafrei_mcp;

GRANT SELECT ON TABLE public.bfrk_stops_live TO viafrei_digest;
GRANT SELECT ON TABLE public.bfrk_stops_live TO viafrei_mcp;

GRANT SELECT ON TABLE public.bw_detours_live TO viafrei_mcp;
GRANT SELECT ON TABLE public.bw_detours_live TO viafrei_digest;

GRANT SELECT ON TABLE public.feed_runs TO viafrei_status;
GRANT SELECT ON TABLE public.feed_runs TO viafrei_mcp;

GRANT SELECT ON TABLE public.charging_feed_runs_live TO viafrei_digest;

GRANT SELECT ON TABLE public.charging_point_status TO viafrei_mcp;

GRANT SELECT ON TABLE public.charging_point_status_live TO viafrei_digest;

GRANT SELECT ON TABLE public.charging_points_live TO viafrei_digest;
GRANT SELECT ON TABLE public.charging_points_live TO viafrei_mcp;

GRANT SELECT ON TABLE public.charging_sites_live TO viafrei_digest;
GRANT SELECT ON TABLE public.charging_sites_live TO viafrei_mcp;

GRANT SELECT ON TABLE public.charging_status_runs TO viafrei_digest;
GRANT SELECT ON TABLE public.charging_status_runs TO viafrei_mcp;

GRANT SELECT ON TABLE public.city_traffic_now_live TO viafrei_mcp;
GRANT SELECT ON TABLE public.city_traffic_now_live TO viafrei_digest;

GRANT SELECT ON TABLE public.city_traffic_pulls_live TO viafrei_mcp;
GRANT SELECT ON TABLE public.city_traffic_pulls_live TO viafrei_digest;

GRANT SELECT ON TABLE public.city_traffic_segments_live TO viafrei_mcp;
GRANT SELECT ON TABLE public.city_traffic_segments_live TO viafrei_digest;

GRANT SELECT ON TABLE public.connect_transit_delays_live TO viafrei_mcp;
GRANT SELECT ON TABLE public.connect_transit_delays_live TO viafrei_digest;

GRANT SELECT(equipment_no) ON TABLE public.db_facilities TO viafrei_mcp;

GRANT SELECT(station_no) ON TABLE public.db_facilities TO viafrei_mcp;

GRANT SELECT(kind) ON TABLE public.db_facilities TO viafrei_mcp;

GRANT SELECT ON TABLE public.db_facilities_live TO viafrei_digest;
GRANT SELECT ON TABLE public.db_facilities_live TO viafrei_mcp;

GRANT SELECT ON TABLE public.db_station_boards TO viafrei_digest;
GRANT SELECT ON TABLE public.db_station_boards TO viafrei_mcp;

GRANT SELECT ON TABLE public.db_station_numbers TO viafrei_mcp;
GRANT SELECT ON TABLE public.db_station_numbers TO viafrei_digest;

GRANT SELECT ON TABLE public.delfi_service_alerts TO viafrei_mcp;

GRANT SELECT ON TABLE public.delfi_service_alerts_live TO viafrei_digest;
GRANT SELECT ON TABLE public.delfi_service_alerts_live TO viafrei_mcp;

GRANT SELECT ON TABLE public.delfi_siri_et_calls TO viafrei_mcp;

GRANT SELECT ON TABLE public.delfi_siri_et_calls_latest TO viafrei_digest;
GRANT SELECT ON TABLE public.delfi_siri_et_calls_latest TO viafrei_mcp;

GRANT SELECT ON TABLE public.delfi_siri_et_calls_live TO viafrei_mcp;

GRANT SELECT ON TABLE public.delfi_siri_et_stop_pairs TO viafrei_digest;
GRANT SELECT ON TABLE public.delfi_siri_et_stop_pairs TO viafrei_mcp;

GRANT SELECT ON TABLE public.deployments TO viafrei_status;

GRANT SELECT ON TABLE public.energy_page_key_heads TO viafrei_digest;

GRANT SELECT ON TABLE public.energy_page_keys TO viafrei_digest;

GRANT SELECT ON TABLE public.energy_page_slug_history TO viafrei_digest;

GRANT SELECT ON TABLE public.energy_page_slugs TO viafrei_digest;
GRANT SELECT ON TABLE public.energy_page_slugs TO viafrei_mcp;

GRANT SELECT ON TABLE public.error_events TO viafrei_ops;

GRANT SELECT ON TABLE public.feed_checks TO viafrei_digest;
GRANT SELECT ON TABLE public.feed_checks TO viafrei_mcp;

GRANT SELECT ON TABLE public.feed_run_extents TO viafrei_digest;
GRANT SELECT ON TABLE public.feed_run_extents TO viafrei_mcp;

GRANT SELECT ON TABLE public.feed_versions TO viafrei_digest;
GRANT SELECT ON TABLE public.feed_versions TO viafrei_mcp;

GRANT SELECT(station_id),INSERT(station_id) ON TABLE public.fuel_price_latest TO viafrei_mcp;

GRANT SELECT(product),INSERT(product) ON TABLE public.fuel_price_latest TO viafrei_mcp;

GRANT SELECT(price),INSERT(price),UPDATE(price) ON TABLE public.fuel_price_latest TO viafrei_mcp;

GRANT SELECT(is_open),INSERT(is_open),UPDATE(is_open) ON TABLE public.fuel_price_latest TO viafrei_mcp;

GRANT SELECT(observed_at),INSERT(observed_at),UPDATE(observed_at) ON TABLE public.fuel_price_latest TO viafrei_mcp;

GRANT SELECT(source_feed),INSERT(source_feed),UPDATE(source_feed) ON TABLE public.fuel_price_latest TO viafrei_mcp;

GRANT SELECT(source_publisher),INSERT(source_publisher),UPDATE(source_publisher) ON TABLE public.fuel_price_latest TO viafrei_mcp;

GRANT SELECT(source_run_id),INSERT(source_run_id),UPDATE(source_run_id) ON TABLE public.fuel_price_latest TO viafrei_mcp;

GRANT INSERT(created_at) ON TABLE public.fuel_price_latest TO viafrei_mcp;

GRANT SELECT(updated_at),INSERT(updated_at),UPDATE(updated_at) ON TABLE public.fuel_price_latest TO viafrei_mcp;

GRANT SELECT ON TABLE public.fuel_price_latest_live TO viafrei_status;
GRANT SELECT ON TABLE public.fuel_price_latest_live TO viafrei_digest;
GRANT SELECT ON TABLE public.fuel_price_latest_live TO viafrei_mcp;

GRANT SELECT ON TABLE public.fuel_station_watch TO viafrei_status;
GRANT SELECT ON TABLE public.fuel_station_watch TO viafrei_mcp;

GRANT INSERT(station_id) ON TABLE public.fuel_station_watch TO viafrei_mcp;

GRANT INSERT(tier),UPDATE(tier) ON TABLE public.fuel_station_watch TO viafrei_mcp;

GRANT INSERT(refresh_interval_s),UPDATE(refresh_interval_s) ON TABLE public.fuel_station_watch TO viafrei_mcp;

GRANT INSERT(reason) ON TABLE public.fuel_station_watch TO viafrei_mcp;

GRANT INSERT(priority),UPDATE(priority) ON TABLE public.fuel_station_watch TO viafrei_mcp;

GRANT UPDATE(last_polled_at) ON TABLE public.fuel_station_watch TO viafrei_mcp;

GRANT UPDATE(last_error) ON TABLE public.fuel_station_watch TO viafrei_mcp;

GRANT UPDATE(consecutive_errors) ON TABLE public.fuel_station_watch TO viafrei_mcp;

GRANT INSERT(asked_at),UPDATE(asked_at) ON TABLE public.fuel_station_watch TO viafrei_mcp;

GRANT SELECT ON TABLE public.ingest_runs TO viafrei_status;
GRANT SELECT ON TABLE public.ingest_runs TO viafrei_mcp;

GRANT INSERT(provider) ON TABLE public.ingest_runs TO viafrei_mcp;

GRANT UPDATE(finished_at) ON TABLE public.ingest_runs TO viafrei_mcp;

GRANT UPDATE(status) ON TABLE public.ingest_runs TO viafrei_mcp;

GRANT UPDATE(rows) ON TABLE public.ingest_runs TO viafrei_mcp;

GRANT UPDATE(bytes) ON TABLE public.ingest_runs TO viafrei_mcp;

GRANT UPDATE(error) ON TABLE public.ingest_runs TO viafrei_mcp;

GRANT UPDATE(skipped_targets) ON TABLE public.ingest_runs TO viafrei_mcp;

GRANT UPDATE(body_sha256) ON TABLE public.ingest_runs TO viafrei_mcp;

GRANT UPDATE(duration_ms) ON TABLE public.ingest_runs TO viafrei_mcp;

GRANT UPDATE(note) ON TABLE public.ingest_runs TO viafrei_mcp;

GRANT UPDATE(next_due_at) ON TABLE public.ingest_runs TO viafrei_mcp;

GRANT UPDATE(worker_version) ON TABLE public.ingest_runs TO viafrei_mcp;

GRANT UPDATE(budget_hit) ON TABLE public.ingest_runs TO viafrei_mcp;

GRANT SELECT ON TABLE public.fuel_feed_health TO viafrei_status;
GRANT SELECT ON TABLE public.fuel_feed_health TO viafrei_mcp;

GRANT INSERT(observed_at) ON TABLE public.fuel_prices TO viafrei_mcp;

GRANT INSERT(station_id) ON TABLE public.fuel_prices TO viafrei_mcp;

GRANT INSERT(product) ON TABLE public.fuel_prices TO viafrei_mcp;

GRANT INSERT(price) ON TABLE public.fuel_prices TO viafrei_mcp;

GRANT INSERT(source_run_id) ON TABLE public.fuel_prices TO viafrei_mcp;

GRANT SELECT ON TABLE public.fuel_products TO viafrei_digest;

GRANT SELECT ON TABLE public.fuel_stations TO viafrei_mcp;

GRANT INSERT(id) ON TABLE public.fuel_stations TO viafrei_mcp;

GRANT INSERT(brand),UPDATE(brand) ON TABLE public.fuel_stations TO viafrei_mcp;

GRANT INSERT(name),UPDATE(name) ON TABLE public.fuel_stations TO viafrei_mcp;

GRANT INSERT(street),UPDATE(street) ON TABLE public.fuel_stations TO viafrei_mcp;

GRANT INSERT(house_no),UPDATE(house_no) ON TABLE public.fuel_stations TO viafrei_mcp;

GRANT INSERT(postcode),UPDATE(postcode) ON TABLE public.fuel_stations TO viafrei_mcp;

GRANT INSERT(city),UPDATE(city) ON TABLE public.fuel_stations TO viafrei_mcp;

GRANT INSERT(geom),UPDATE(geom) ON TABLE public.fuel_stations TO viafrei_mcp;

GRANT INSERT(updated_at),UPDATE(updated_at) ON TABLE public.fuel_stations TO viafrei_mcp;

GRANT INSERT(first_seen_at) ON TABLE public.fuel_stations TO viafrei_mcp;

GRANT INSERT(last_seen_at),UPDATE(last_seen_at) ON TABLE public.fuel_stations TO viafrei_mcp;

GRANT INSERT(source_feed),UPDATE(source_feed) ON TABLE public.fuel_stations TO viafrei_mcp;

GRANT INSERT(source_publisher),UPDATE(source_publisher) ON TABLE public.fuel_stations TO viafrei_mcp;

GRANT INSERT(source_run_id),UPDATE(source_run_id) ON TABLE public.fuel_stations TO viafrei_mcp;

GRANT INSERT(created_at) ON TABLE public.fuel_stations TO viafrei_mcp;

GRANT SELECT ON TABLE public.fuel_stations_live TO viafrei_digest;
GRANT SELECT ON TABLE public.fuel_stations_live TO viafrei_mcp;

GRANT SELECT ON TABLE public.fuel_station_board_live TO viafrei_digest;

GRANT SELECT ON TABLE public.gazetteer_places TO viafrei_status;
GRANT SELECT ON TABLE public.gazetteer_places TO viafrei_digest;
GRANT SELECT ON TABLE public.gazetteer_places TO viafrei_mcp;

GRANT SELECT ON TABLE public.gbfs_station_status TO viafrei_mcp;

GRANT SELECT ON TABLE public.gbfs_station_status_live TO viafrei_digest;

GRANT SELECT ON TABLE public.gbfs_stations_live TO viafrei_mcp;
GRANT SELECT ON TABLE public.gbfs_stations_live TO viafrei_digest;

GRANT SELECT ON TABLE public.gbfs_vehicles_live TO viafrei_mcp;
GRANT SELECT ON TABLE public.gbfs_vehicles_live TO viafrei_digest;

GRANT SELECT ON TABLE public.growth_weekly TO viafrei_status;

GRANT SELECT ON TABLE public.gtfs_route_kreise TO viafrei_mcp;

GRANT SELECT ON TABLE public.gtfs_service_dates TO viafrei_mcp;
GRANT SELECT ON TABLE public.gtfs_service_dates TO viafrei_digest;

GRANT SELECT ON TABLE public.gtfs_untimed_trips TO viafrei_mcp;

GRANT SELECT ON TABLE public.hh_cameras TO viafrei_mcp;

GRANT SELECT ON TABLE public.hh_cameras_live TO viafrei_digest;

GRANT SELECT ON TABLE public.hh_roadworks_live TO viafrei_mcp;
GRANT SELECT ON TABLE public.hh_roadworks_live TO viafrei_digest;

GRANT SELECT ON TABLE public.host_samples TO viafrei_status;

GRANT SELECT ON TABLE public.hydrogen_stations_live TO viafrei_mcp;
GRANT SELECT ON TABLE public.hydrogen_stations_live TO viafrei_digest;

GRANT SELECT ON TABLE public.landing_collect_cursor TO viafrei_status;

GRANT SELECT ON TABLE public.landing_error_hourly TO viafrei_status;

GRANT SELECT ON TABLE public.landing_reloads TO viafrei_status;

GRANT SELECT ON TABLE public.landing_status_hourly TO viafrei_status;

GRANT SELECT ON TABLE public.lez_zone_overlaps TO viafrei_mcp;
GRANT SELECT ON TABLE public.lez_zone_overlaps TO viafrei_digest;

GRANT SELECT ON TABLE public.lez_zones_live TO viafrei_mcp;
GRANT SELECT ON TABLE public.lez_zones_live TO viafrei_digest;

GRANT SELECT ON TABLE public.lorry_city_live TO viafrei_mcp;
GRANT SELECT ON TABLE public.lorry_city_live TO viafrei_digest;

GRANT SELECT ON TABLE public.lorry_hb_live TO viafrei_mcp;
GRANT SELECT ON TABLE public.lorry_hb_live TO viafrei_digest;

GRANT SELECT ON TABLE public.lorry_ivm_live TO viafrei_mcp;
GRANT SELECT ON TABLE public.lorry_ivm_live TO viafrei_digest;

GRANT SELECT ON TABLE public.lorry_long_network_live TO viafrei_mcp;
GRANT SELECT ON TABLE public.lorry_long_network_live TO viafrei_digest;

GRANT SELECT ON TABLE public.lorry_reads_live TO viafrei_mcp;
GRANT SELECT ON TABLE public.lorry_reads_live TO viafrei_digest;

GRANT SELECT ON TABLE public.lorry_sevas_live TO viafrei_mcp;
GRANT SELECT ON TABLE public.lorry_sevas_live TO viafrei_digest;

GRANT SELECT ON TABLE public.los_lane_now_live TO viafrei_mcp;
GRANT SELECT ON TABLE public.los_lane_now_live TO viafrei_digest;

GRANT SELECT ON TABLE public.los_now_live TO viafrei_mcp;
GRANT SELECT ON TABLE public.los_now_live TO viafrei_digest;

GRANT SELECT ON TABLE public.mcp_usage TO viafrei_mcp;
GRANT SELECT ON TABLE public.mcp_usage TO viafrei_status;

GRANT INSERT(period) ON TABLE public.mcp_usage TO viafrei_mcp;

GRANT INSERT(period_start) ON TABLE public.mcp_usage TO viafrei_mcp;

GRANT INSERT(door) ON TABLE public.mcp_usage TO viafrei_mcp;

GRANT INSERT(rpc) ON TABLE public.mcp_usage TO viafrei_mcp;

GRANT INSERT(tool) ON TABLE public.mcp_usage TO viafrei_mcp;

GRANT INSERT(client) ON TABLE public.mcp_usage TO viafrei_mcp;

GRANT INSERT(requests),UPDATE(requests) ON TABLE public.mcp_usage TO viafrei_mcp;

GRANT INSERT(errors),UPDATE(errors) ON TABLE public.mcp_usage TO viafrei_mcp;

GRANT INSERT(sessions),UPDATE(sessions) ON TABLE public.mcp_usage TO viafrei_mcp;

GRANT INSERT(total_ms),UPDATE(total_ms) ON TABLE public.mcp_usage TO viafrei_mcp;

GRANT INSERT(ms_le_100),UPDATE(ms_le_100) ON TABLE public.mcp_usage TO viafrei_mcp;

GRANT INSERT(ms_le_250),UPDATE(ms_le_250) ON TABLE public.mcp_usage TO viafrei_mcp;

GRANT INSERT(ms_le_500),UPDATE(ms_le_500) ON TABLE public.mcp_usage TO viafrei_mcp;

GRANT INSERT(ms_le_1000),UPDATE(ms_le_1000) ON TABLE public.mcp_usage TO viafrei_mcp;

GRANT INSERT(ms_le_2500),UPDATE(ms_le_2500) ON TABLE public.mcp_usage TO viafrei_mcp;

GRANT INSERT(ms_le_5000),UPDATE(ms_le_5000) ON TABLE public.mcp_usage TO viafrei_mcp;

GRANT INSERT(ms_le_10000),UPDATE(ms_le_10000) ON TABLE public.mcp_usage TO viafrei_mcp;

GRANT INSERT(ms_gt_10000),UPDATE(ms_gt_10000) ON TABLE public.mcp_usage TO viafrei_mcp;

GRANT INSERT(updated_at),UPDATE(updated_at) ON TABLE public.mcp_usage TO viafrei_mcp;

GRANT INSERT(refusals),UPDATE(refusals) ON TABLE public.mcp_usage TO viafrei_mcp;

GRANT INSERT(tool_errors),UPDATE(tool_errors) ON TABLE public.mcp_usage TO viafrei_mcp;

GRANT INSERT(server_errors),UPDATE(server_errors) ON TABLE public.mcp_usage TO viafrei_mcp;

GRANT INSERT(tool_error_invalid_input),UPDATE(tool_error_invalid_input) ON TABLE public.mcp_usage TO viafrei_mcp;

GRANT INSERT(tool_error_not_found),UPDATE(tool_error_not_found) ON TABLE public.mcp_usage TO viafrei_mcp;

GRANT INSERT(tool_error_out_of_coverage),UPDATE(tool_error_out_of_coverage) ON TABLE public.mcp_usage TO viafrei_mcp;

GRANT INSERT(tool_error_unavailable),UPDATE(tool_error_unavailable) ON TABLE public.mcp_usage TO viafrei_mcp;

GRANT INSERT(tool_error_limit_reached),UPDATE(tool_error_limit_reached) ON TABLE public.mcp_usage TO viafrei_mcp;

GRANT INSERT(tool_error_timeout),UPDATE(tool_error_timeout) ON TABLE public.mcp_usage TO viafrei_mcp;

GRANT INSERT(tool_error_internal),UPDATE(tool_error_internal) ON TABLE public.mcp_usage TO viafrei_mcp;

GRANT SELECT ON TABLE public.mcp_usage_exports TO viafrei_status;

GRANT SELECT ON TABLE public.motorway_points_live TO viafrei_digest;
GRANT SELECT ON TABLE public.motorway_points_live TO viafrei_mcp;

GRANT SELECT ON TABLE public.motorway_register_live TO viafrei_digest;

GRANT SELECT ON TABLE public.motorway_summary_live TO viafrei_digest;

GRANT SELECT ON TABLE public.mvv_bus_load_live TO viafrei_mcp;
GRANT SELECT ON TABLE public.mvv_bus_load_live TO viafrei_digest;

GRANT SELECT ON TABLE public.oom_kills TO viafrei_status;

GRANT SELECT ON TABLE public.opendata_roadworks_live TO viafrei_mcp;
GRANT SELECT ON TABLE public.opendata_roadworks_live TO viafrei_digest;

GRANT SELECT ON TABLE public.ops_audit TO viafrei_ops;

GRANT SELECT(id) ON TABLE public.ops_audit TO viafrei_status;

GRANT SELECT(at) ON TABLE public.ops_audit TO viafrei_status;

GRANT SELECT(actor) ON TABLE public.ops_audit TO viafrei_status;
GRANT INSERT(actor) ON TABLE public.ops_audit TO viafrei_ops;

GRANT SELECT(action) ON TABLE public.ops_audit TO viafrei_status;
GRANT INSERT(action) ON TABLE public.ops_audit TO viafrei_ops;

GRANT SELECT(target) ON TABLE public.ops_audit TO viafrei_status;
GRANT INSERT(target) ON TABLE public.ops_audit TO viafrei_ops;

GRANT SELECT(before) ON TABLE public.ops_audit TO viafrei_status;
GRANT INSERT(before) ON TABLE public.ops_audit TO viafrei_ops;

GRANT SELECT(after) ON TABLE public.ops_audit TO viafrei_status;
GRANT INSERT(after) ON TABLE public.ops_audit TO viafrei_ops;

GRANT SELECT(result) ON TABLE public.ops_audit TO viafrei_status;
GRANT INSERT(result) ON TABLE public.ops_audit TO viafrei_ops;

GRANT INSERT(client_ip) ON TABLE public.ops_audit TO viafrei_ops;

GRANT SELECT,DELETE ON TABLE public.ops_passkeys TO viafrei_ops;

GRANT INSERT(credential_id) ON TABLE public.ops_passkeys TO viafrei_ops;

GRANT INSERT(public_key) ON TABLE public.ops_passkeys TO viafrei_ops;

GRANT INSERT(sign_count),UPDATE(sign_count) ON TABLE public.ops_passkeys TO viafrei_ops;

GRANT INSERT(transports) ON TABLE public.ops_passkeys TO viafrei_ops;

GRANT INSERT(label) ON TABLE public.ops_passkeys TO viafrei_ops;

GRANT UPDATE(last_used_at) ON TABLE public.ops_passkeys TO viafrei_ops;

GRANT SELECT ON TABLE public.ops_requests TO viafrei_status;
GRANT SELECT ON TABLE public.ops_requests TO viafrei_ops;

GRANT INSERT(action) ON TABLE public.ops_requests TO viafrei_ops;

GRANT INSERT(target) ON TABLE public.ops_requests TO viafrei_ops;

GRANT INSERT(requested_by) ON TABLE public.ops_requests TO viafrei_ops;

GRANT SELECT ON TABLE public.ops_rollup_daily TO viafrei_status;

GRANT SELECT ON TABLE public.ops_rollup_feed TO viafrei_status;

GRANT SELECT ON TABLE public.ops_rollup_held TO viafrei_status;

GRANT SELECT ON TABLE public.ops_rollup_usage TO viafrei_status;

GRANT SELECT ON TABLE public.osm_addresses TO viafrei_mcp;

GRANT SELECT ON TABLE public.osm_addresses_live TO viafrei_digest;

GRANT SELECT ON TABLE public.osm_boundary_de TO viafrei_digest;
GRANT SELECT ON TABLE public.osm_boundary_de TO viafrei_mcp;

GRANT SELECT ON TABLE public.osm_pois TO viafrei_mcp;

GRANT SELECT ON TABLE public.osm_pois_live TO viafrei_digest;
GRANT SELECT ON TABLE public.osm_pois_live TO viafrei_mcp;

GRANT SELECT ON TABLE public.osm_replication_state TO viafrei_mcp;

GRANT SELECT ON TABLE public.osm_speed_cameras_live TO viafrei_mcp;
GRANT SELECT ON TABLE public.osm_speed_cameras_live TO viafrei_digest;

GRANT SELECT ON TABLE public.osm_streets TO viafrei_digest;

GRANT SELECT ON TABLE public.osm_street_tiles TO viafrei_digest;

GRANT SELECT ON TABLE public.osm_street_tiles_lo TO viafrei_digest;

GRANT SELECT ON TABLE public.parking_facilities_bysa TO viafrei_mcp;

GRANT SELECT ON TABLE public.parking_facilities_bysa_live TO viafrei_digest;

GRANT SELECT ON TABLE public.parking_facilities_live TO viafrei_digest;
GRANT SELECT ON TABLE public.parking_facilities_live TO viafrei_mcp;

GRANT SELECT ON TABLE public.parking_facilities_odbl TO viafrei_mcp;

GRANT SELECT ON TABLE public.parking_facilities_odbl_live TO viafrei_digest;

GRANT SELECT ON TABLE public.parking_facilities_sid_live TO viafrei_mcp;
GRANT SELECT ON TABLE public.parking_facilities_sid_live TO viafrei_digest;

GRANT SELECT ON TABLE public.parking_forecast_profiles_live TO viafrei_mcp;
GRANT SELECT ON TABLE public.parking_forecast_profiles_live TO viafrei_digest;

GRANT SELECT ON TABLE public.parking_occupancy TO viafrei_mcp;

GRANT SELECT ON TABLE public.parking_occupancy_live TO viafrei_digest;

GRANT SELECT ON TABLE public.parking_occupancy_odbl TO viafrei_mcp;

GRANT SELECT ON TABLE public.parking_occupancy_odbl_live TO viafrei_digest;

GRANT SELECT ON TABLE public.parking_occupancy_sid_live TO viafrei_mcp;
GRANT SELECT ON TABLE public.parking_occupancy_sid_live TO viafrei_digest;

REVOKE SELECT ON TABLE public.pg_stat_statements FROM PUBLIC;

REVOKE SELECT ON TABLE public.pg_stat_statements_info FROM PUBLIC;

GRANT SELECT ON TABLE public.place_slugs TO viafrei_digest;
GRANT SELECT ON TABLE public.place_slugs TO viafrei_mcp;

GRANT SELECT ON TABLE public.place_websites TO viafrei_digest;

GRANT SELECT ON TABLE public.provider_key_claims TO viafrei_status;

GRANT SELECT(provider) ON TABLE public.provider_key_claims TO viafrei_mcp;

GRANT SELECT(last_request_at),UPDATE(last_request_at) ON TABLE public.provider_key_claims TO viafrei_mcp;

GRANT UPDATE(claimed_by) ON TABLE public.provider_key_claims TO viafrei_mcp;

GRANT SELECT(person_wanted_at),UPDATE(person_wanted_at) ON TABLE public.provider_key_claims TO viafrei_mcp;

GRANT SELECT ON TABLE public.registered_sources TO viafrei_status;

GRANT SELECT ON TABLE public.road_context_live TO viafrei_mcp;
GRANT SELECT ON TABLE public.road_context_live TO viafrei_digest;

GRANT SELECT ON TABLE public.road_event_locations_live TO viafrei_mcp;

GRANT SELECT ON TABLE public.road_event_twins TO viafrei_digest;
GRANT SELECT ON TABLE public.road_event_twins TO viafrei_mcp;

GRANT SELECT ON TABLE public.road_events_live TO viafrei_digest;
GRANT SELECT ON TABLE public.road_events_live TO viafrei_mcp;

GRANT SELECT ON TABLE public.road_weather_forecast TO viafrei_mcp;

GRANT SELECT ON TABLE public.road_weather_forecast_live TO viafrei_digest;

GRANT SELECT ON TABLE public.road_weather_stations TO viafrei_mcp;

GRANT SELECT ON TABLE public.road_weather_stations_live TO viafrei_digest;

GRANT SELECT ON TABLE public.routes_live TO viafrei_mcp;
GRANT SELECT ON TABLE public.routes_live TO viafrei_digest;

GRANT SELECT ON TABLE public.search_console_weekly TO viafrei_status;

GRANT SELECT ON TABLE public.search_console_weekly_parts TO viafrei_status;

GRANT SELECT ON TABLE public.service_alert_lands_live TO viafrei_status;

GRANT SELECT ON TABLE public.site_visits_daily TO viafrei_status;

GRANT SELECT ON TABLE public.site_visits_devices TO viafrei_status;

GRANT SELECT ON TABLE public.site_visits_entries TO viafrei_status;

GRANT SELECT ON TABLE public.site_visits_entry_referrers TO viafrei_status;

GRANT SELECT ON TABLE public.site_visits_hourly TO viafrei_status;

GRANT SELECT ON TABLE public.site_visits_pages_per_visit TO viafrei_status;

GRANT SELECT ON TABLE public.site_visits_referrers TO viafrei_status;

GRANT SELECT ON TABLE public.site_visits_routes TO viafrei_status;

GRANT SELECT ON TABLE public.site_visits_search_engines TO viafrei_status;

GRANT SELECT ON TABLE public.source_hosts TO viafrei_ops;

GRANT SELECT ON TABLE public.speed_enforcement_live TO viafrei_mcp;
GRANT SELECT ON TABLE public.speed_enforcement_live TO viafrei_digest;

GRANT SELECT ON TABLE public.station_accessibility_live TO viafrei_mcp;
GRANT SELECT ON TABLE public.station_accessibility_live TO viafrei_digest;

GRANT SELECT ON TABLE public.station_equipment_live TO viafrei_mcp;
GRANT SELECT ON TABLE public.station_equipment_live TO viafrei_digest;

GRANT SELECT ON TABLE public.station_equipment_state TO viafrei_mcp;
GRANT SELECT ON TABLE public.station_equipment_state TO viafrei_digest;

GRANT SELECT ON TABLE public.station_slugs TO viafrei_digest;

GRANT SELECT ON TABLE public.station_index_live TO viafrei_digest;
GRANT SELECT ON TABLE public.station_index_live TO viafrei_mcp;

GRANT SELECT ON TABLE public.station_metro_osm_decided TO viafrei_digest;

GRANT SELECT ON TABLE public.stop_access_odbl TO viafrei_mcp;

GRANT SELECT ON TABLE public.stop_times_live TO viafrei_mcp;
GRANT SELECT ON TABLE public.stop_times_live TO viafrei_digest;

GRANT SELECT ON TABLE public.stops_live TO viafrei_mcp;
GRANT SELECT ON TABLE public.stops_live TO viafrei_digest;

GRANT SELECT ON TABLE public.street_bays_live TO viafrei_mcp;
GRANT SELECT ON TABLE public.street_bays_live TO viafrei_digest;

GRANT SELECT ON TABLE public.traffic_count_now_live TO viafrei_mcp;
GRANT SELECT ON TABLE public.traffic_count_now_live TO viafrei_digest;

GRANT SELECT ON TABLE public.traffic_count_profiles_live TO viafrei_mcp;
GRANT SELECT ON TABLE public.traffic_count_profiles_live TO viafrei_digest;

GRANT SELECT ON TABLE public.transit_delays TO viafrei_mcp;

GRANT SELECT ON TABLE public.transit_delays_live TO viafrei_digest;
GRANT SELECT ON TABLE public.transit_delays_live TO viafrei_mcp;

GRANT SELECT ON TABLE public.transit_departures_odbl_live TO viafrei_mcp;
GRANT SELECT ON TABLE public.transit_departures_odbl_live TO viafrei_digest;

GRANT SELECT ON TABLE public.transit_odbl_service_days_live TO viafrei_mcp;
GRANT SELECT ON TABLE public.transit_odbl_service_days_live TO viafrei_digest;

GRANT SELECT ON TABLE public.transit_punctuality_area_live TO viafrei_digest;

GRANT SELECT ON TABLE public.transit_station_live TO viafrei_digest;

GRANT SELECT ON TABLE public.transit_stop_modes TO viafrei_digest;
GRANT SELECT ON TABLE public.transit_stop_modes TO viafrei_mcp;

GRANT SELECT ON TABLE public.transit_stops_odbl_live TO viafrei_mcp;
GRANT SELECT ON TABLE public.transit_stops_odbl_live TO viafrei_digest;

GRANT SELECT ON TABLE public.translation_cache TO viafrei_digest;
GRANT SELECT ON TABLE public.translation_cache TO viafrei_translate;

GRANT INSERT(key) ON TABLE public.translation_cache TO viafrei_translate;

GRANT INSERT(lang) ON TABLE public.translation_cache TO viafrei_translate;

GRANT INSERT(model) ON TABLE public.translation_cache TO viafrei_translate;

GRANT INSERT(text) ON TABLE public.translation_cache TO viafrei_translate;

GRANT UPDATE(last_used_at) ON TABLE public.translation_cache TO viafrei_translate;

GRANT SELECT ON TABLE public.trips_live TO viafrei_mcp;
GRANT SELECT ON TABLE public.trips_live TO viafrei_digest;

GRANT SELECT ON TABLE public.validator_horizon TO viafrei_status;

GRANT SELECT ON TABLE public.vbb_transit_delays TO viafrei_mcp;

GRANT SELECT ON TABLE public.vbb_transit_delays_live TO viafrei_digest;

GRANT SELECT ON TABLE public.vbn_transit_delays TO viafrei_mcp;

GRANT SELECT ON TABLE public.vbn_transit_delays_live TO viafrei_digest;

GRANT SELECT ON TABLE public.vrn_transit_delays TO viafrei_mcp;

GRANT SELECT ON TABLE public.vrn_transit_delays_live TO viafrei_digest;

GRANT SELECT ON TABLE public.watch_events TO viafrei_mcp;

GRANT SELECT ON TABLE public.watches TO viafrei_mcp;

GRANT INSERT(session_id) ON TABLE public.watches TO viafrei_mcp;

GRANT INSERT(kind) ON TABLE public.watches TO viafrei_mcp;

GRANT INSERT(key) ON TABLE public.watches TO viafrei_mcp;

GRANT INSERT(condition) ON TABLE public.watches TO viafrei_mcp;

GRANT INSERT(created_at) ON TABLE public.watches TO viafrei_mcp;

GRANT INSERT(expires_at) ON TABLE public.watches TO viafrei_mcp;

GRANT UPDATE(stopped_at) ON TABLE public.watches TO viafrei_mcp;

GRANT SELECT ON TABLE public.weather_warnings_live TO viafrei_mcp;

GRANT SELECT ON TABLE public.weather_warnings_area_live TO viafrei_digest;

GRANT SELECT ON TABLE public.weather_warnings_en_live TO viafrei_mcp;

GRANT SELECT ON TABLE public.worker_boots TO viafrei_status;
GRANT DELETE ON TABLE public.worker_boots TO viafrei_mcp;

GRANT SELECT(id) ON TABLE public.worker_boots TO viafrei_mcp;

GRANT SELECT(worker),INSERT(worker) ON TABLE public.worker_boots TO viafrei_mcp;

GRANT INSERT(worker_version) ON TABLE public.worker_boots TO viafrei_mcp;

GRANT INSERT(git_sha) ON TABLE public.worker_boots TO viafrei_mcp;

GRANT INSERT(hostname) ON TABLE public.worker_boots TO viafrei_mcp;

GRANT INSERT(node_version) ON TABLE public.worker_boots TO viafrei_mcp;

GRANT SELECT(booted_at) ON TABLE public.worker_boots TO viafrei_mcp;

GRANT INSERT(config) ON TABLE public.worker_boots TO viafrei_mcp;

REFRESH MATERIALIZED VIEW public.gtfs_route_kreise;

REFRESH MATERIALIZED VIEW public.gtfs_untimed_trips;

REFRESH MATERIALIZED VIEW public.osm_street_tiles;

REFRESH MATERIALIZED VIEW public.osm_street_tiles_lo;

REFRESH MATERIALIZED VIEW public.transit_stop_modes;

-- The ledger table's privileges: schema_migrations is created by migrate before
-- this file runs, and is not part of the dump above.

GRANT SELECT ON TABLE public.schema_migrations TO viafrei_status;
