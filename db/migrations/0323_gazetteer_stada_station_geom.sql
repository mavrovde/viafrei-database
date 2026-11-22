-- The stops-near read (stations of a mode around a point) looks up, for each
-- rail and S-Bahn stop it lists, the DB station within 300 m:
--   ... from gazetteer_places g where g.source_id = 'db_stada' and g.kind = 'station'
--        and g.closed_at is null and g.geom is not null and st_dwithin(g.geom, n.geom, 300)
-- No index served that predicate: the plan was a BitmapAnd of the full
-- geometry GiST with the (kind, rank) btree, which read every one of about
-- 37 000 'station' rows per lookup (1.8 ms of 2.1 ms per loop). Production,
-- 2026-11-22, built by hand as the first fix of the manual database round:
-- the read went from 20.0 to 12.9 ms per call (60 s pg_stat_statements
-- delta), EXPLAIN Frankfurt 50.0 -> 6.0 ms, Berlin 36.9 -> 22.0 ms. The index
-- holds the 5 408 open DB stations with a position (392 kB).
--
-- Production already holds the index under this name. The file adopts it
-- only if it is the index this file would build: VALID, and its definition
-- (pg_get_indexdef) exactly the one below. Anything else under the name, an
-- INVALID leftover of a failed concurrent build or another definition, stops
-- the file with an error naming what it found: an operator decides, the
-- migration never drops an index it did not build.
--
-- Lock: not concurrently. A plain create index takes SHARE on
-- gazetteer_places (reads go on, writes wait) for the build, about a second
-- on production's 390 000 rows. gazetteer_places is reference data its loader
-- writes once a day, so a second's wait of that loader is fine. The migrator
-- wraps each file in its own begin/commit, so the lock ends with this file's
-- commit, not with the batch; lock_timeout bounds the wait for the lock
-- (rule 6), and migrate retries the file on 55P03.
--
-- rollback:
--   drop index concurrently if exists public.gazetteer_places_stada_station_geom;
--   delete from schema_migrations where version = 323;

set local lock_timeout = '5s';

do $$
declare
  expected constant text := 'CREATE INDEX gazetteer_places_stada_station_geom ON public.gazetteer_places USING gist (geom) WHERE ((source_id = ''db_stada''::text) AND (kind = ''station''::text) AND (closed_at IS NULL) AND (geom IS NOT NULL))';
  found_def text;
  found_valid boolean;
begin
  select pg_get_indexdef(x.indexrelid), x.indisvalid
    into found_def, found_valid
    from pg_index x
    join pg_class i on i.oid = x.indexrelid
   where i.relnamespace = 'public'::regnamespace
     and i.relname = 'gazetteer_places_stada_station_geom';
  if not found then
    return;
  end if;
  if not found_valid then
    raise exception 'gazetteer_places_stada_station_geom exists but is INVALID (a failed concurrent build): drop it by hand, then migrate again';
  end if;
  if found_def is distinct from expected then
    raise exception 'gazetteer_places_stada_station_geom exists with another definition: %', found_def
      using detail = 'expected: ' || expected;
  end if;
end
$$;

create index if not exists gazetteer_places_stada_station_geom
  on public.gazetteer_places using gist (geom)
  where source_id = 'db_stada' and kind = 'station' and closed_at is null and geom is not null;
