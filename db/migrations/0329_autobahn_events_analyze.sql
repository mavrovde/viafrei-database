-- Every day partition of public.autobahn_events is analysed after 1 % of its
-- rows plus 2 000 changed (autovacuum_analyze_scale_factor 0.01, threshold
-- 2000), not after the default 10 % plus 50. The table is written all day and
-- read for its newest minutes; at the default the planner's statistics of
-- today's partition trail its newest ticks for hours, so it estimates a recent
-- window at a few dozen rows when it holds thousands, and reads it by the
-- observed_at btree where the position index would bound it.
--
-- PostgreSQL 16 keeps autovacuum options per leaf (a partitioned parent takes
-- none), and ensure_daily_partitions makes a day as create table ... like
-- ... including all, which copies no storage parameter, so the setting is
-- held in one place: tick_partition_options(part), called by
-- ensure_daily_partitions for every partition in its window (as
-- tick_brin_autosummarize is), and run here once over every existing
-- partition. Production was given it by hand on 2026-11-22 for the days
-- through 2026-11-29.
--
-- ensure_daily_partitions(days_ahead, days_back) is 0304's body with the one
-- call added; its signature, arguments, refusals and notice are unchanged.
-- The one-argument form is restated unchanged, so both bodies live here.
--
-- Lock: alter table ... set (autovacuum_...) takes SHARE UPDATE EXCLUSIVE,
-- which blocks no reader and no writer; each runs under lock_timeout 2s in
-- its own subtransaction, and a partition another session holds is skipped
-- with a NOTICE (the next ensure run sets it).
--
-- rollback:
--   re-run 0304's create function ensure_daily_partitions(integer, integer) as create or replace;
--   alter table <each autobahn_events partition> reset (autovacuum_analyze_scale_factor, autovacuum_analyze_threshold);
--   drop function public.tick_partition_options(regclass);
--   delete from schema_migrations where version = 329;

CREATE OR REPLACE FUNCTION public.tick_partition_options(part regclass) RETURNS integer
    LANGUAGE plpgsql
    AS $$
declare
  want constant text[] := '{autovacuum_analyze_scale_factor=0.01,autovacuum_analyze_threshold=2000}';
  parent regclass;
  prev text := current_setting('lock_timeout');
begin
  select i.inhparent::regclass into parent from pg_inherits i where i.inhrelid = part;
  if parent is distinct from 'public.autobahn_events'::regclass then
    return 0;
  end if;
  if (select coalesce(c.reloptions, '{}') @> want from pg_class c where c.oid = part) then
    return 0;
  end if;
  begin
    perform set_config('lock_timeout', '2s', true);
    execute format('alter table %s set (autovacuum_analyze_scale_factor = 0.01, autovacuum_analyze_threshold = 2000)', part);
  exception when lock_not_available or deadlock_detected then
    raise notice 'tick_partition_options: % is locked by another session (%); skipped, the next run sets it', part, sqlerrm;
    perform set_config('lock_timeout', prev, true);
    return 0;
  end;
  perform set_config('lock_timeout', prev, true);
  return 1;
end $$;

COMMENT ON FUNCTION public.tick_partition_options(pg_catalog.regclass) IS 'Gives one day partition of public.autobahn_events autovacuum_analyze_scale_factor 0.01 and autovacuum_analyze_threshold 2000 where it does not carry both, and returns 1 when it set them, else 0 (any other relation: 0, untouched). The ALTER runs in its own subtransaction under lock_timeout = 2s; a partition another session holds is skipped with a NOTICE, and the caller''s lock_timeout is restored. Called by ensure_daily_partitions for every partition in its window, because a day made LIKE its parent copies no storage parameter. Migration 0329.';

CREATE OR REPLACE FUNCTION public.ensure_daily_partitions(days_ahead integer, days_back integer) RETURNS void
    LANGUAGE plpgsql
    AS $$
declare
  min_tick_tables integer;
  daily_exempt constant text[] := '{}';
  schemas text[];
  s text; t text; d date; part text;
  covered text[]; n integer; total integer := 0; made integer := 0; stray text;
  summarized integer := 0;
begin
  if days_ahead is null or days_ahead < 0 or days_ahead > 400 then
    raise exception 'ensure_daily_partitions: days_ahead must be 0..400, got %', days_ahead;
  end if;
  if days_back is null or days_back < 0 or days_back > 400 then
    raise exception 'ensure_daily_partitions: days_back must be 0..400, got % (a start date in the future, or more than 400 days back)', days_back;
  end if;
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
        perform tick_partition_options(format('%I.%I', s, part)::regclass);
      end loop;
    end loop;
    total := total + n;
  end loop;

  raise notice 'ensure_daily_partitions: % table(s) on the daily schedule in schema(s) %, days % .. %, % partition(s) created, % BRIN index(es) set to autosummarize',
    total, array_to_string(schemas, ', '), current_date - days_back, current_date + days_ahead, made, summarized;
end $$;

-- The one-argument form, as 0304 left it, restated here so this file holds the helper's whole current text.
CREATE OR REPLACE FUNCTION public.ensure_daily_partitions(days_ahead integer DEFAULT 7) RETURNS void
    LANGUAGE plpgsql
    AS $$
begin
  perform public.ensure_daily_partitions(days_ahead, 3);
end $$;

DO $$
DECLARE
  part regclass;
BEGIN
  FOR part IN SELECT i.inhrelid::regclass FROM pg_inherits i WHERE i.inhparent = 'public.autobahn_events'::regclass LOOP
    PERFORM public.tick_partition_options(part);
  END LOOP;
END $$;
