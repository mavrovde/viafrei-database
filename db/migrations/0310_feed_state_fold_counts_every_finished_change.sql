-- A finished run's change counts whatever its status (#32 finding).
--
-- control.feed_state_after_change folded no row whose status was 'running' or
-- 'pending', while control.recompute_feed_state takes last_changed_at from any
-- finished, non-budget row that inserted, updated or closed something. The
-- writers say the recompute is right: 'pending' is a terminal status (the
-- cycle ran, the contract is not ACTIVE; packages/ingest/src/platform/
-- feed-runs.ts), and the ended-source close pass (#844,
-- connectors/ended-sources.ts) writes exactly a finished 'pending' row with
-- items_closed > 0 -- a change of the data the fold never saw. Production held
-- 11 finished 'pending' feed_runs rows on 2026-11-15.
--
-- The trigger now hands every finished row to the fold. Nothing else moves
-- there: the run_fact flags already confine attempt, success and refusal to
-- their statuses, so a 'pending' (or an ingest 'running') row can only carry a
-- change. The shape stays legal -- a finished 'pending' row is correct data,
-- so no CHECK forbids it.
--
-- The second half of the same disagreement: the fold keeps a row for a key
-- whose only fact is a change (a 'skipped' close pass did so before this
-- migration too), the recompute wrote a row only for an attempt or a refusal
-- and so deleted it. The recompute now keeps the row when a change exists,
-- as the fold does; data_status reads such a row as never attempted and never
-- stale, the same as no row, with last_changed_at the one thing it adds.
--
-- The keys whose held state may be behind are recomputed below, once.
--
-- rollback:
--   re-create control.feed_state_after_change() and control.recompute_feed_state()
--   as db/baseline/0293_baseline.sql defines them (the two "and n.status not in
--   ('running', 'pending')" filters back; the change no longer keeps a row);
--   the recomputed feed_state rows stay, they equal the recompute's answer;
--   delete from schema_migrations where version = 310;

CREATE OR REPLACE FUNCTION control.feed_state_after_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'control', 'public', 'pg_temp'
AS $function$
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
         where n.finished_at is not null and not (n.feed_key = any(v_recompute))));
    else
      perform control.fold_feed_state('ingest', array(
        select row(n.provider, n.finished_at, n.status, n.next_due_at, n.budget_hit,
                   n.budget_hit is null and n.status in ('ok', 'degraded', 'error', 'interrupted'),
                   n.budget_hit is null and n.status in ('ok', 'degraded'),
                   n.budget_hit is null and coalesce(n.rows, 0) > 0,
                   n.budget_hit is not null and n.status in ('ok', 'degraded', 'error', 'interrupted'))::control.run_fact
          from new_rows n
         where n.finished_at is not null and not (n.provider = any(v_recompute))));
    end if;
  end if;
  return null;
end $function$;

CREATE OR REPLACE FUNCTION control.recompute_feed_state(p_ledger text, p_keys text[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'control', 'public', 'pg_temp'
AS $function$
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
           g.finished_at,
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
      left join lateral (
        select r.finished_at from feed_runs r
         where r.feed_key = k.key and r.finished_at is not null and r.budget_hit is null
           and coalesce(r.items_inserted, 0) + coalesce(r.items_updated, 0) + coalesce(r.items_closed, 0) > 0
         order by r.finished_at desc limit 1) g on true
     where a.finished_at is not null or h.finished_at is not null or g.finished_at is not null;
  else
    insert into control.feed_state (ledger, key, budget_key, next_due_at, last_attempt_at, last_attempt_status,
                                    last_success_at, last_changed_at, last_refusal_at, last_refusal, refused_since, updated_at)
    select 'ingest', k.key,
           (select p.budget_key from control.providers p where p.provider = split_part(k.key, ':', 1)),
           a.next_due_at, a.finished_at, a.status,
           (select r.finished_at from ingest_runs r
             where r.provider = k.key and r.finished_at is not null and r.budget_hit is null and r.status in ('ok', 'degraded')
             order by r.finished_at desc limit 1),
           g.finished_at,
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
      left join lateral (
        select r.finished_at from ingest_runs r
         where r.provider = k.key and r.finished_at is not null and r.budget_hit is null and coalesce(r.rows, 0) > 0
         order by r.finished_at desc limit 1) g on true
     where a.finished_at is not null or h.finished_at is not null or g.finished_at is not null;
  end if;
end $function$;

select control.recompute_feed_state('feed', array(
  select distinct r.feed_key from feed_runs r
   where r.finished_at is not null and r.budget_hit is null and r.status = 'pending'
     and coalesce(r.items_inserted, 0) + coalesce(r.items_updated, 0) + coalesce(r.items_closed, 0) > 0));

select control.recompute_feed_state('ingest', array(
  select distinct r.provider from ingest_runs r
   where r.finished_at is not null and r.budget_hit is null and r.status in ('running', 'pending')
     and coalesce(r.rows, 0) > 0));
