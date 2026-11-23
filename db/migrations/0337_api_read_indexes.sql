-- no-transaction: builds three indexes with create index concurrently, which
-- PostgreSQL refuses inside a transaction block. Idempotent: an INVALID index
-- of the same name (a concurrent build that failed) is dropped first, and each
-- build is if not exists, so a database that holds a valid index under the
-- name (built by hand on production) is left as it is.
--
-- Three indexes the API's statements over the platform's tables need, ahead
-- of the contract views' drop (the next release): each was proved on
-- production, read only, by the statement's plan without it, and on a test
-- database by the plan with it, under the custom and the generic plan both
-- (docs/perf/sql-plans.md in viafrei-api, Set B).
--
--   osm_addresses_open_land_extract (land, extract_date desc nulls last)
--     where closed_at is null: the place coverage's newest extract per Land.
--     Without it each Land's probe sorts every open address of the Land
--     (production 2026-11-23, estimated: 1.2 M rows a Land, a plan cost of
--     91.7 M); with it each probe is the first entry of the Land's range. About the
--     size of osm_addresses_open_land (236 MB), whose second column is wider.
--   weather_warnings_area_desc (area_desc) where deleted_at is null: the
--     warnings of a cell asked by its name, and whether any warning names it.
--     Without it the name test reads the table (production: a sequential
--     scan, 34 ms; the cell's warnings 10 400 buffers, 100 ms); with it the
--     name is an index condition, beside weather_warnings_live_cell in one
--     BitmapOr. 328 000 rows of 10 900 names: a few MB.
--   osm_pois_brand_lower_trgm gin (lower(brand) gin_trgm_ops) where brand is
--     not null: the POI match's brand test, lower(brand) like '%…%'. Without
--     it the match reads every POI (production: a sequential scan of 2 M rows,
--     850 ms), as osm_pois_brand_trgm holds brand as written; with it the
--     name and the brand are one BitmapOr of two trigram indexes. 175 000
--     brands: about the 12 MB of osm_pois_brand_trgm.
--
-- api_reader's SELECT on control.data_status and its USAGE on schema control
-- are granted again (0336 grants both; production runs 0335): the API reads
-- the feed status view directly, and this release states it beside the
-- indexes its reads need. GRANT is a catalogue change; lock_timeout bounds it.
--
-- A concurrent build holds SHARE UPDATE EXCLUSIVE, which blocks no writer.
--
-- Production, read only, 2026-11-23: osm_addresses 5476 MB of heap (19.6 M
-- open rows), osm_pois 433 MB, weather_warnings 427 MB. The server's
-- maintenance_work_mem is 256 MB and max_parallel_maintenance_workers 0; this
-- file sets 64 MB and 0 for its own session, as 0334 does, so each build is
-- one worker. The migrating role (viafrei) has no role-level
-- statement_timeout (the service roles have one; api_reader's is 2 s), so no
-- build is cut off. A concurrent build reads the heap twice (the build, then
-- the validation scan). The osm_addresses build, timed on a test database
-- (326 MB of heap, 2 M rows: 3.5 s at 64 MB, 4.0 s at 256 MB) and scaled to
-- 5.5 GB, is about one minute; a heap not in cache and the server's load can
-- make it several. The other two are seconds.
--
-- rollback:
--   set lock_timeout = '5s';
--   drop index concurrently if exists public.osm_addresses_open_land_extract;
--   drop index concurrently if exists public.weather_warnings_area_desc;
--   drop index concurrently if exists public.osm_pois_brand_lower_trgm;
--   delete from schema_migrations where version = 337;
-- (the grants stay: 0336 holds them.)

set max_parallel_maintenance_workers = 0;
set maintenance_work_mem = '64MB';

-- An INVALID index of one of the three names (a failed concurrent build).
select format('drop index concurrently if exists %I.%I', n.nspname, c.relname)
  from pg_class c
  join pg_index x on x.indexrelid = c.oid
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relname in ('osm_addresses_open_land_extract', 'weather_warnings_area_desc', 'osm_pois_brand_lower_trgm')
   and not x.indisvalid
\gexec

create index concurrently if not exists osm_addresses_open_land_extract
  on public.osm_addresses (land, extract_date desc nulls last) where closed_at is null;
create index concurrently if not exists weather_warnings_area_desc
  on public.weather_warnings (area_desc) where deleted_at is null;
create index concurrently if not exists osm_pois_brand_lower_trgm
  on public.osm_pois using gin (lower(brand) public.gin_trgm_ops) where brand is not null;

reset maintenance_work_mem;
reset max_parallel_maintenance_workers;

set lock_timeout = '5s';
grant usage on schema control to api_reader;
grant select on control.data_status to api_reader;
reset lock_timeout;

-- Each index VALID, or the file fails and is retried from the top.
do $$
declare
  bad text;
begin
  select string_agg(n, ', ') into bad
    from unnest(array['osm_addresses_open_land_extract', 'weather_warnings_area_desc', 'osm_pois_brand_lower_trgm']) n
   where not exists (select 1 from pg_class c join pg_index x on x.indexrelid = c.oid
                      where c.oid = to_regclass('public.' || n) and x.indisvalid);
  if bad is not null then
    raise exception '0337: % missing or INVALID', bad;
  end if;
end
$$;
