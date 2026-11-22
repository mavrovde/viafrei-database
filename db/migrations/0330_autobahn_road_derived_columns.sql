-- autobahn_road_derived_columns: per-row values every road reader derives again on every read,
-- stored once at write time.
--
-- Autobahn GmbH rows (autobahn_events): the item's start and "future" flag, its site key (#505),
-- its extent's end points, and the next instant its own validity windows can change
-- (autobahn_validity_next_change at observed_at) with the answer there (validity_at_write), and whether it states any readable window at all
-- (states_validity), so a reader runs autobahn_validity_overlaps only on rows that state one.
--
-- autobahn_validity_overlaps is re-created as ONE pass over the description: each line is read
-- and tested against the two headings once (it was read twice, and each heading tested twice),
-- the except days are collected in the same loop, and the window lines are kept and parsed after
-- it against the complete except set, exactly as the second pass did. Its answer is unchanged
-- (the result is the same for every order of the window lines: any window in reach is true). The motorway summary, the road tools and the national Land read
-- take these for about 3 500 live rows on every read; the Land read alone was about 2.2 s a
-- call, 13 592 calls in eight days on production (pg_stat_statements).
-- DATEX II situations (road_events): the clock-free half of the entry facts the road reader
-- builds from the payload (primary and secondary Alert-C point, the senses of every record, the
-- works type, the line).
--
-- ONE TEXT. Each function body below is the application's reader expression of the same name,
-- generated from it (@viafrei/ingest: autobahnStartsAt, autobahnSiteKey, the Land read's extent
-- parse, entryFactsSql's first half), so a stored value is what the reader computes today. The
-- application's parity test runs both over its fixtures against this image before its readers
-- switch; this repository's test pins each function on planted payloads.
--
-- WRITE TIME. road_events fills itself: road_events_entry_static, BEFORE INSERT OR UPDATE OF
-- payload, sets entry_static from the row's payload, so the loader's upsert (which rewrites
-- payload on every pull) never leaves the old facts in place; the rows written before 0330 are
-- filled by road_events_entry_static_backfill(n), at most n rows a call, oldest id first (a
-- partial index on the unfilled ids keeps each call from reading past the filled ones), under the
-- caller's statement and lock timeouts; it returns how many it filled, and the operator (or the
-- application at start) calls it until 0. autobahn_events needs a writer release: the
-- application's writer fills the columns from the payload it writes; until it does, a NULL means
-- "not written by such a writer", and the readers read coalesce(column, function(...)), the same
-- value either way. autobahn_events is a tick table and ticks are append-only, so nothing is
-- backfilled there; should a row ever be updated in a column the values are derived from,
-- autobahn_events_derived_reset sets them NULL (computed by the coalesce again), never stale.
--
-- Online: the columns are nullable with no default, so each `add column` changes the catalogue
-- only and rewrites nothing; lock_timeout makes it give up on a writer's lock rather than queue
-- every reader behind it (`migrate` retries 55P03).
--
-- rollback:
--   set lock_timeout = '3s';
--   drop trigger if exists road_events_entry_static on public.road_events;
--   drop function if exists public.road_events_fill_entry_static();
--   drop index if exists public.road_events_entry_static_unfilled;
--   drop trigger if exists autobahn_events_derived_reset on public.autobahn_events;
--   drop function if exists public.autobahn_events_reset_derived();
--   alter table public.autobahn_events drop column if exists derived_starts_at, drop column if exists derived_future,
--     drop column if exists derived_site_key, drop column if exists derived_extent_ends,
--     drop column if exists validity_next_change, drop column if exists states_validity,
--     drop column if exists validity_at_write;
--   drop function if exists public.autobahn_validity_stated(jsonb);
--   (autobahn_validity_overlaps: re-create the two-pass body of the 0293 baseline)
--   drop function if exists public.autobahn_validity_next_change(jsonb, timestamptz);
--   alter table public.road_events drop column if exists entry_static;
--   drop function if exists public.road_events_entry_static_backfill(integer);
--   drop function if exists public.road_event_entry_static(jsonb);
--   drop function if exists public.autobahn_extent_ends(text);
--   drop function if exists public.autobahn_site_key(text, text, text, text, text, text, text, integer, jsonb, timestamptz, boolean);
--   drop function if exists public.autobahn_starts_at(jsonb);
--   delete from schema_migrations where version = 330;

set local lock_timeout = '3s';

alter table public.autobahn_events
  add column if not exists derived_starts_at timestamptz,
  add column if not exists derived_future boolean,
  add column if not exists derived_site_key uuid,
  add column if not exists derived_extent_ends geography(MultiPoint, 4326),
  add column if not exists validity_next_change timestamptz,
  add column if not exists states_validity boolean,
  add column if not exists validity_at_write boolean;

alter table public.road_events
  add column if not exists entry_static jsonb;

-- autobahnStartsAt(raw): the stated start (startTimestamp, else "gültig:/Beginn: DD.MM.YY HH:MM",
-- Berlin) and the provider's "future" flag. `raw` is the resolved payload.
create or replace function public.autobahn_starts_at(p_raw jsonb, out starts_at timestamptz, out future boolean)
language sql
stable parallel safe
as $function$
select coalesce(
             case when p_raw->>'startTimestamp' is not null and pg_input_is_valid(p_raw->>'startTimestamp', 'timestamptz')
                  then (p_raw->>'startTimestamp')::timestamptz end,
             (select case when ph is not null
                               and pg_input_is_valid(format('20%s-%s-%s %s:%s', ph[3], ph[2], ph[1], ph[4], ph[5]), 'timestamp')
                          then format('20%s-%s-%s %s:%s', ph[3], ph[2], ph[1], ph[4], ph[5])::timestamp at time zone 'Europe/Berlin' end
                from regexp_match(
                       case when jsonb_typeof(p_raw->'description') = 'array'
                            then concat_ws(' ', p_raw->'description'->>0, p_raw->'description'->>1, p_raw->'description'->>2, p_raw->'description'->>3) end,
                       '(?:gültig:|Beginn:)[[:space:]]*([0-9]{1,2})[.]([0-9]{1,2})[.](?:20)?([0-9]{2})[[:space:]]+(?:(?:um|von)[[:space:]]+)?([0-9]{1,2}):([0-9]{2})') as ph)
           ) as starts_at,
           coalesce(p_raw->>'future', '') = 'true' as future
$function$;

-- autobahnSiteKey: the fold key of one site (#505), of the row's columns, its resolved payload
-- and its start (autobahn_starts_at of that payload).
create or replace function public.autobahn_site_key(p_road text, p_kind text, p_ext_id text, p_title text, p_subtitle text,
                                                    p_extent text, p_traffic text, p_delay integer, p_raw jsonb,
                                                    p_starts_at timestamptz, p_future boolean)
returns jsonb
language sql
stable parallel safe
as $function$
  select jsonb_build_array(
      p_road, p_kind, regexp_replace(p_ext_id, '[.]de[0-9]+$', ''),
      p_title, p_subtitle,
      case when coalesce(btrim(p_title), '') = '' and coalesce(btrim(p_subtitle), '') = '' then p_extent end,
      p_traffic, p_delay,
      p_raw->>'isBlocked', p_raw->>'averageSpeed', x.starts_at, x.future,
      case when p_raw->>'startTimestamp' is null then null
           when pg_input_is_valid(p_raw->>'startTimestamp', 'timestamptz') then ((p_raw->>'startTimestamp')::timestamptz)::text
           else 'unreadable:' || (p_raw->>'startTimestamp') end,
      (with d as (
              -- A line as both readers see it: trimmed as JavaScript trims, and a non-string is a paragraph break.
              select a.o, a.x, case when jsonb_typeof(a.x) = 'string' then regexp_replace((a.x #>> '{}'), '^[\t\n\v\f\r\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+|[\t\n\v\f\r\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+$', '', 'g') else '' end as t
              from jsonb_array_elements(case when jsonb_typeof(p_raw->'description') = 'array' then p_raw->'description' else '[]'::jsonb end)
                   with ordinality as a(x, o)),
            -- Lines cleanDescription MAY drop: "Beginn: …" and anything with a "seit <date>" clause.
            maybe_dropped as (select o from d where t <> '' and t ~* '^Beginn:|seit[\t\n\v\f\r\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+[0-9]'),
            -- Lines it surely PRINTS: the rest, and a heading only when the next
            -- line that is not maybe-dropped has text (a heading over an empty
            -- line is dropped). Missing a printed line only makes the key finer.
            printed as (
              select d.o from d
              where d.t <> '' and d.o not in (select o from maybe_dropped)
                and (d.t !~ ':$'
                     or coalesce((select n.t <> '' from d as n
                                   where n.o > d.o and n.o not in (select o from maybe_dropped)
                                   order by n.o limit 1), false)))
       select coalesce(jsonb_agg(d.x order by d.o), '[]'::jsonb)
       from d
       -- Up to the end of the paragraph that holds the second printed line.
       where d.o < coalesce((select min(b.o) from d as b
                              where b.t = '' and b.o > (select o from printed order by o offset 1 limit 1)), 2147483647)))
    from (select p_starts_at as starts_at, p_future as future) x
$function$;

-- The end points of one segment's extent ("lat,lon,lat,lon"), as the Land read parses them:
-- four decimal numbers or nothing, each point inside the coordinate ranges and not 0,0; NULL
-- when no point is placed. The reader takes a site's distinct points from its rows' points.
create or replace function public.autobahn_extent_ends(p_extent text)
returns geography(MultiPoint, 4326)
language sql
immutable parallel safe
as $function$
  select st_multi(st_collect(e.p))::geography(MultiPoint, 4326)
    from (select distinct st_setsrid(st_makepoint(e.lon, e.lat), 4326) as p
            from (select case when p_extent ~ '^ *-?[0-9]+(\.[0-9]+)? *, *-?[0-9]+(\.[0-9]+)? *, *-?[0-9]+(\.[0-9]+)? *, *-?[0-9]+(\.[0-9]+)? *$' then split_part(p_extent, ',', k * 2 + 1)::float8 end as lat,
                         case when p_extent ~ '^ *-?[0-9]+(\.[0-9]+)? *, *-?[0-9]+(\.[0-9]+)? *, *-?[0-9]+(\.[0-9]+)? *, *-?[0-9]+(\.[0-9]+)? *$' then split_part(p_extent, ',', k * 2 + 2)::float8 end as lon
                    from generate_series(0, 1) k) e
           where e.lat between -90 and 90 and e.lon between -180 and 180 and not (e.lat = 0 and e.lon = 0)) e
  having count(*) > 0
$function$;

-- entryFactsSql's clock-free half: the situation's own place, senses, works type and line.
create or replace function public.road_event_entry_static(p_payload jsonb)
returns jsonb
language sql
immutable parallel safe
as $function$
  select (jsonb_build_object(
    'pri', coalesce(jsonb_path_query_first(p_payload, '$.situationRecord[0].groupOfLocations.**.alertCMethod4PrimaryPointLocation.alertCLocation.specificLocation."#text"'),
                    jsonb_path_query_first(p_payload, '$.situationRecord[0].groupOfLocations.**.alertCMethod2PrimaryPointLocation.alertCLocation.specificLocation."#text"')),
    'sec', coalesce(jsonb_path_query_first(p_payload, '$.situationRecord[0].groupOfLocations.**.alertCMethod4SecondaryPointLocation.alertCLocation.specificLocation."#text"'),
                    jsonb_path_query_first(p_payload, '$.situationRecord[0].groupOfLocations.**.alertCMethod2SecondaryPointLocation.alertCLocation.specificLocation."#text"')),
    'senses', jsonb_path_query_array(p_payload, '$.situationRecord[*].groupOfLocations.**.alertCDirectionCoded."#text"'),
    'works', jsonb_path_query_first(p_payload, '$.situationRecord[0].generalPublicComment ? (@.commentExtension.commentExtended.commentType2."#text" == "roadworksType").comment.values.value."#text"'),
    'line', jsonb_path_query_first(p_payload, '$.situationRecord[0].groupOfLocations.**.gmlLineString.posList."#text"')
  ))
$function$;

-- Every insert, and every update that writes payload, stores the payload's facts (the loader's
-- upsert sets payload on every pull). The backfill's own update writes entry_static only and
-- does not fire it.
create or replace function public.road_events_fill_entry_static()
returns trigger
language plpgsql
as $function$
begin
  new.entry_static := public.road_event_entry_static(new.payload);
  return new;
end
$function$;

drop trigger if exists road_events_entry_static on public.road_events;
create trigger road_events_entry_static before insert or update of payload on public.road_events
  for each row execute function public.road_events_fill_entry_static();

-- The rows written before 0330, the only ones the backfill walks: new rows arrive filled.
create index if not exists road_events_entry_static_unfilled on public.road_events (id) where entry_static is null;

-- autobahn_events rows are never updated; should one be in a column its derived values come from,
-- they are set NULL, which every reader computes from the payload as before (never a stale value).
create or replace function public.autobahn_events_reset_derived()
returns trigger
language plpgsql
as $function$
begin
  new.derived_starts_at := null;
  new.derived_future := null;
  new.derived_site_key := null;
  new.derived_extent_ends := null;
  new.validity_next_change := null;
  new.states_validity := null;
  new.validity_at_write := null;
  return new;
end
$function$;

drop trigger if exists autobahn_events_derived_reset on public.autobahn_events;
create trigger autobahn_events_derived_reset before update of observed_at, road, kind, ext_id, title, subtitle,
    abnormal_traffic_type, delay_s, extent, raw, raw_hash on public.autobahn_events
  for each row execute function public.autobahn_events_reset_derived();

-- Fills entry_static of at most p_batch rows that lack it, oldest id first; returns how many.
create or replace function public.road_events_entry_static_backfill(p_batch integer)
returns integer
language sql
volatile
as $function$
  with b as (
    select id from public.road_events
     where entry_static is null
     order by id
     limit greatest(p_batch, 0)
     for update skip locked
  ), u as (
    update public.road_events e
       set entry_static = public.road_event_entry_static(e.payload)
      from b
     where e.id = b.id
    returning 1
  )
  select count(*)::int from u
$function$;

comment on column public.autobahn_events.derived_starts_at is 'autobahn_starts_at(resolved payload).starts_at, stored by the writer (0330); NULL: not written by a writer that fills it, read as the function.';
comment on column public.autobahn_events.derived_future is 'autobahn_starts_at(resolved payload).future, stored by the writer (0330); NULL: not written by a writer that fills it.';
comment on column public.autobahn_events.derived_site_key is 'md5(autobahn_site_key(...)::text)::uuid of the row under its filed road (#505), stored by the writer (0330): the readers only group and count by the key, and 16 bytes a tick row hold what the jsonb key took about 400 for; NULL: not written by a writer that fills it.';
comment on column public.autobahn_events.derived_extent_ends is 'autobahn_extent_ends(extent), stored by the writer (0330); NULL when the extent places no point or the row was not written by a writer that fills it.';
comment on column public.road_events.entry_static is 'road_event_entry_static(payload), stored at write time (0330) and by road_events_entry_static_backfill; NULL: not yet filled, read as the function.';
comment on column public.autobahn_events.validity_next_change is 'autobahn_validity_next_change(resolved payload description, observed_at), stored by the writer (0330): NULL when the description states no window, or the row was not written by a writer that fills it.';

-- autobahn_validity_next_change(description, at): the first instant AFTER `at` at which
-- autobahn_validity_overlaps(description, x, x) can change. It walks the same passes and the
-- same three line forms as autobahn_validity_overlaps and returns the smallest window bound
-- (start or end) later than `at`; 'infinity' when windows are stated but none is later; NULL
-- when no readable window is stated. Every bound is a Berlin wall-clock minute, so on
-- [at, next_change) the answer of overlaps is the answer at `at`. A touching bound is still
-- returned: early, never late.
create or replace function public.autobahn_validity_next_change(description jsonb, at timestamptz)
returns timestamptz
language plpgsql
stable parallel safe
as $function$
declare
  l text;
  m text[];
  section text := '';
  except_days date[] := '{}';
  stated boolean := false;
  at_day date := (at at time zone 'Europe/Berlin')::date;
  best timestamptz := null;
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

  -- Pass 1: the exception days, exactly as autobahn_validity_overlaps reads them.
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

  -- Pass 2: the same windows, each contributing its bounds later than `at`.
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
        -- From the day before `at` (a window of that day can run past midnight) up to d2; a later
        -- day's window starts later, so the walk stops once a start is past the best bound.
        dd := greatest(d1, at_day - 1);
        while dd <= d2 loop
          w_start := (dd + t1) at time zone 'Europe/Berlin';
          exit when best is not null and w_start > best;
          if extract(isodow from dd)::int = any(dows) and not (dd = any(except_days)) then
            w_end := (case when t2 <= t1 then dd + 1 else dd end + t2) at time zone 'Europe/Berlin';
            if w_start > at and (best is null or w_start < best) then best := w_start; end if;
            if w_end > at and (best is null or w_end < best) then best := w_end; end if;
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
        if w_start > at and (best is null or w_start < best) then best := w_start; end if;
        if w_end > at and (best is null or w_end < best) then best := w_end; end if;
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
          if w_start > at and (best is null or w_start < best) then best := w_start; end if;
          if w_end > at and (best is null or w_end < best) then best := w_end; end if;
        end if;
        continue;
      end if;
  end loop;

  if not stated then return null; end if;
  return coalesce(best, 'infinity'::timestamptz);
end
$function$;

comment on function public.autobahn_validity_next_change(jsonb, timestamptz) is 'The first instant after `at` at which autobahn_validity_overlaps(description, x, x) can change: the smallest stated window bound later than `at` (0330). ''infinity'' when windows are stated but none ends or starts later; NULL when the description states no readable window. Early at a bound where nothing flips, never late.';

comment on column public.autobahn_events.states_validity is 'autobahn_validity_stated(resolved payload description), stored by the writer (0330): false = autobahn_validity_overlaps is NULL at every instant, so a reader need not call it; NULL: not written by a writer that fills it.';

create or replace function public.autobahn_validity_overlaps(description jsonb, from_at timestamptz, to_at timestamptz)
returns boolean
language plpgsql
stable parallel safe
as $_$
declare
  l text;
  m text[];
  in_except boolean := false;
  in_list boolean := false;
  is_except boolean;
  is_list boolean;
  except_days date[] := '{}';
  list_lines text[] := '{}';
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

  -- One read of the lines: the except days of the "gilt nicht an folgenden Tagen" sections, and
  -- the lines of the "Zeiträumen gültig" sections. A heading or an empty line ends a section.
  for l in select btrim(x) from jsonb_array_elements_text(description) with ordinality as t(x, n) where n <= 60 order by n loop
    is_except := l ~* 'gilt nicht an folgenden Tagen';
    is_list := l ~* 'Zeiträumen gültig';
    if is_except then
      in_except := true;
    elsif is_list or l = '' then
      in_except := false;
    elsif in_except then
      for m in select regexp_matches(l, '([0-9]{1,2})\.([0-9]{1,2})\.([0-9]{2,4})', 'g') loop
        dd := autobahn_validity_date(m[1], m[2], m[3]);
        if dd is not null then except_days := except_days || dd; end if;
      end loop;
    end if;
    if is_list then
      in_list := true;
    elsif l = '' or is_except then
      in_list := false;
    elsif in_list then
      list_lines := list_lines || l;
    end if;
  end loop;

  -- The window lines, against the complete except set. Every form is anchored at the line's start
  -- with "Jeden " or a digit, so any other line is no window.
  foreach l in array list_lines loop
    if l is null or l !~ '^(Jeden |[0-9])' then continue; end if;
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

-- Whether the description states any readable window: autobahn_validity_overlaps is NULL at every
-- instant exactly when this is false (whether a line states a window never depends on the instant;
-- the epoch only keeps the weekly walk empty).
create or replace function public.autobahn_validity_stated(description jsonb)
returns boolean
language sql
stable parallel safe
as $function$
  select public.autobahn_validity_overlaps(description, to_timestamp(0), to_timestamp(0)) is not null
$function$;

comment on function public.autobahn_validity_stated(jsonb) is 'True when autobahn_validity_overlaps(description, ...) is not NULL (any readable window stated); stored in autobahn_events.states_validity (0330).';

comment on column public.autobahn_events.validity_at_write is 'autobahn_validity_overlaps(resolved payload description, observed_at, observed_at), stored by the writer (0330): the answer at every instant in [observed_at, validity_next_change); NULL when no window is stated or the row was not written by a writer that fills it.';
