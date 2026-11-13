-- Neutral texts: the error hints, exception messages and run notes of eleven
-- functions, and the notes of the two timetable feeds, say what they mean
-- without pointing at internal tickets, file paths or process names. No
-- behaviour changes: each function is replaced by its current definition
-- with only those literals reworded (same signature, attributes, owner and
-- grants), and each note is set by its feed's provider key.
--
-- rollback: irreversible (the earlier wording is not restored; nothing reads
--   it). To forget the ledger row: delete from schema_migrations where version = 293;

CREATE OR REPLACE FUNCTION control.audit_change() RETURNS trigger
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

CREATE OR REPLACE FUNCTION control.check_budget_shape() RETURNS trigger
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

CREATE OR REPLACE FUNCTION control.fit_shares(p_budget_key text) RETURNS integer
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

CREATE OR REPLACE FUNCTION control.publish_terms(p jsonb) RETURNS TABLE(callers integer, budgets integer, providers integer, shares integer)
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

CREATE OR REPLACE FUNCTION control.set_budget(p_budget_key text, p_caller text, p_field text, p_value numeric, p_actor text, p_reason text) RETURNS void
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

CREATE OR REPLACE FUNCTION ingestor.project_run(p_run_id bigint) RETURNS void
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

CREATE OR REPLACE FUNCTION public.ensure_daily_partitions(days_ahead integer DEFAULT 7) RETURNS void
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

CREATE OR REPLACE FUNCTION public.ops_audit_forget_ips() RETURNS integer
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

CREATE OR REPLACE FUNCTION public.ops_requests_rate_limit() RETURNS trigger
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

CREATE OR REPLACE FUNCTION public.ops_requests_source_guard() RETURNS trigger
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

CREATE OR REPLACE FUNCTION public.runtime_config_source_bounds() RETURNS trigger
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

update public.feeds
   set extras = jsonb_set(extras, '{note}', to_jsonb('release id, validity and the last load''s counts are written here by the timetable loader'::text))
 where provider = 'delfi_static' and extras ? 'note';

update public.feeds
   set extras = jsonb_set(extras, '{note}', to_jsonb('VBN Connect (Niedersachsen und Bremen), CC BY 4.0, loaded from the publisher''s current release; release fingerprint and the last load''s counts are written here by the loader'::text))
 where provider = 'connect_static' and extras ? 'note';
