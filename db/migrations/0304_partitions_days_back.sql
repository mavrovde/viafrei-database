-- partitions ensure --days-back N / --from DATE: the daily partitions of every
-- tick table from N days behind today (not only the fixed three) through
-- today + days_ahead, so a database that must hold a dated past row (a test of
-- retention, of a rollup over last month, a restore) gets its partitions from
-- the schema's own helper instead of a hand-written `partition of`.
--
-- ensure_daily_partitions(days_ahead, days_back) is the one implementation:
-- the body of ensure_daily_partitions(days_ahead) as 0296 left it, both
-- schemas, its constant days_back (3) made an argument and both counts bounded
-- to 0..400 (the CLI's own bound). The one-argument function keeps its
-- signature, its default and its behaviour, and now calls the two-argument
-- one with 3. Nothing here drops a partition.
--
-- rollback:
--   create or replace function public.ensure_daily_partitions(days_ahead integer default 7) ... (its body in 0296);
--   drop function public.ensure_daily_partitions(integer, integer);
--   delete from schema_migrations where version = 304;

CREATE FUNCTION public.ensure_daily_partitions(days_ahead integer, days_back integer) RETURNS void
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
      end loop;
    end loop;
    total := total + n;
  end loop;

  raise notice 'ensure_daily_partitions: % table(s) on the daily schedule in schema(s) %, days % .. %, % partition(s) created, % BRIN index(es) set to autosummarize',
    total, array_to_string(schemas, ', '), current_date - days_back, current_date + days_ahead, made, summarized;
end $$;


CREATE OR REPLACE FUNCTION public.ensure_daily_partitions(days_ahead integer DEFAULT 7) RETURNS void
    LANGUAGE plpgsql
    AS $$
begin
  perform public.ensure_daily_partitions(days_ahead, 3);
end $$;
