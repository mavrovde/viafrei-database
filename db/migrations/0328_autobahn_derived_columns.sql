-- autobahn_derived_columns: per-row values every Autobahn reader derives again on every read, stored
-- once by the writer, and the instant an item's own validity windows next change.
--
-- The motorway summary, check_road_status / check_autobahn_traffic and the national Land read
-- (LAND_TRAFFIC_SQL, about 2.2 s a call on production, 13 592 calls in eight days) all take, for
-- each of about 3 500 live rows: the resolved payload, its start (startTimestamp or the
-- "gültig:/Beginn:" text), the site key (#505), the extent's end points, and whether the row is
-- inside its own stated windows at the clock (autobahn_validity_overlaps, about 0.3 ms a row for
-- the 1 387 of 3 490 rows that state windows). The writer fills the new columns at insert time,
-- by the same rules the readers apply (they are SQL fragments of @viafrei/ingest; this file
-- defines no copy of them). The readers switch to the columns only after a release of the
-- application that writes them, so a NULL here means "not written by such a writer" and a
-- reader never reads one as a value.
--
-- autobahn_validity_next_change(description, at): the first instant AFTER `at` at which
-- autobahn_validity_overlaps(description, x, x) can change. It walks the same passes and the
-- same three line forms as autobahn_validity_overlaps and returns the smallest window bound
-- (start or end) later than `at`; 'infinity' when the description states windows but none of
-- their bounds is later; NULL when it states no readable window (overlaps is then NULL at every
-- instant). Every bound is a Berlin wall-clock minute, so on [at, next_change) the answer of
-- overlaps at an instant is the answer at `at`. A bound where the answer does not actually flip
-- (two touching windows) is still returned: early, never late.
--
-- Online: the columns are nullable with no default, so `alter table … add column` on the
-- partitioned parent (and, through it, every day partition) changes the catalogue only and
-- rewrites nothing; it takes ACCESS EXCLUSIVE on each partition for that instant, so
-- lock_timeout makes it give up on a writer's lock instead of queueing every reader behind it
-- (`migrate` retries 55P03). Nothing is backfilled here: the readers read the latest tick of
-- each road within 30 minutes, and the application backfills that window in batches before
-- its readers switch (its release note says so).
--
-- rollback:
--   set lock_timeout = '3s';
--   alter table public.autobahn_events
--     drop column if exists derived_starts_at, drop column if exists derived_future,
--     drop column if exists derived_site_key, drop column if exists derived_extent_ends,
--     drop column if exists validity_next_change;
--   drop function if exists public.autobahn_validity_next_change(jsonb, timestamptz);
--   delete from schema_migrations where version = 328;

set local lock_timeout = '3s';

alter table public.autobahn_events
  add column if not exists derived_starts_at timestamptz,
  add column if not exists derived_future boolean,
  add column if not exists derived_site_key jsonb,
  add column if not exists derived_extent_ends geography(MultiPoint, 4326),
  add column if not exists validity_next_change timestamptz;

comment on column public.autobahn_events.derived_starts_at is 'The item''s start as the readers'' rule (autobahnStartsAt of @viafrei/ingest) reads it from the resolved payload, stored by the writer (0328). NULL with derived_future NULL: not written by a writer that fills it.';
comment on column public.autobahn_events.derived_future is 'The payload''s "future" flag as the readers'' rule reads it, stored by the writer (0328); NULL: not written by a writer that fills it.';
comment on column public.autobahn_events.derived_site_key is 'The site key (#505, autobahnSiteKey of @viafrei/ingest) of the row, stored by the writer (0328); NULL: not written by a writer that fills it.';
comment on column public.autobahn_events.derived_extent_ends is 'The end points of the row''s extent ("lat,lon,lat,lon", the readers'' EXTENT rule), stored by the writer (0328); NULL when the extent places no point or the row was not written by a writer that fills it.';
comment on column public.autobahn_events.validity_next_change is 'autobahn_validity_next_change(description, observed_at) of the resolved payload, stored by the writer (0328): NULL when the description states no window.';

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

comment on function public.autobahn_validity_next_change(jsonb, timestamptz) is 'The first instant after `at` at which autobahn_validity_overlaps(description, x, x) can change: the smallest stated window bound later than `at` (0328). ''infinity'' when windows are stated but none ends or starts later; NULL when the description states no readable window. Early at a bound where nothing flips, never late.';
