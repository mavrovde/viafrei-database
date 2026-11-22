-- no-transaction: builds indexes with create index concurrently, which
-- PostgreSQL refuses inside a transaction block. Idempotent: an INVALID index a
-- failed build left is dropped first, each build and each statistics object is
-- if not exists, each drop if exists.
--
-- 1. Expression statistics the planner cannot take from an index (2.6.43).
--    PostgreSQL keeps statistics for an index expression, but the planner reads
--    them only from an index WITHOUT a predicate. charging_points_evse_norm is
--    partial (where evse_id is not null), so every equality on the normalised
--    EVSE id fell back to the default selectivity, 0.5 % of the table:
--    production 2026-11-22, 2 170 estimated rows per lookup against 1-2 real
--    (285 k distinct keys in 434 k rows, the commonest 5). The charging page by
--    identity runs four such lookups (7 172 of its 52 746 cost units each), so
--    its generic plan's cost followed reltuples and moved at every autoanalyze
--    by more than a custom plan's planning surcharge: auto then planned custom
--    on almost every call until its average caught up (prod 21:10Z, 323 plans
--    in 724 calls a minute, 37 ms each, 201 plan ms/s). An expression
--    statistics object gives the planner the expression's own statistics.
--    Created by hand on production on 2026-11-22 (with an analyze), recorded
--    here; so are the two publishable objects made by hand earlier, which give
--    the coalesce(confidentiality, 'noRestriction') filter of every charging
--    read its real selectivity.
--
-- 2. contract.lorry_rule's distance read (viafrei-api). The view states
--    r.geom::geometry as geometry and the API writes geometry::geography, as
--    for every contract position (0313); the lorry tables' gist indexes are on
--    geom itself, so no index matched and each lorry table was read whole.
--    Production 2026-11-22, read only, Köln 6.96/50.94 within 2 000 m: 2 175 and
--    2 338 ms, 17 341 buffers; through the tables' own gist, the same 1 594 rows
--    (same md5) in 52 and 68 ms, 2 014 buffers. Each expression below is,
--    character for character, the one the view's cast and the API's give after
--    the planner pushes the filter into each arm of the union, on the rows the
--    _live views read (closed_at is null).
--
-- 3. Unused tick indexes. delfi_siri_et_calls_stop and vbn_siri_et_calls_stop
--    (stop_ref, observed_at), from the baseline, are partitioned indexes: each
--    day's partition carries a copy (production 2026-11-22: 22 copies, 1 504 MB,
--    idx_scan 0 in total and last_idx_scan null on every one, statistics never
--    reset). The stop reads go through delfi_siri_et_calls_latest; the tick
--    tables are written and read by observed_at (their brin). Dropping the
--    partitioned index drops every copy and the ones partitions ensure would
--    give the days ahead. A partitioned index cannot be dropped concurrently:
--    the drop takes ACCESS EXCLUSIVE on the table and its partitions for the
--    moment it lasts, bounded by lock_timeout (a wait longer fails with 55P03
--    and migrate retries the file).
--
-- rollback:
--   drop statistics if exists public.charging_points_evse_norm_expr;
--   (charging_points_publishable and charging_sites_publishable predate this file)
--   drop index concurrently if exists public.lorry_long_network_contract_geography;
--   drop index concurrently if exists public.lorry_sevas_contract_geography;
--   drop index concurrently if exists public.lorry_ivm_contract_geography;
--   drop index concurrently if exists public.lorry_hb_contract_geography;
--   drop index concurrently if exists public.lorry_city_contract_geography;
--   create index delfi_siri_et_calls_stop on only public.delfi_siri_et_calls using btree (stop_ref, observed_at);
--   create index vbn_siri_et_calls_stop on only public.vbn_siri_et_calls using btree (stop_ref, observed_at);
--     (then one create index concurrently + alter index ... attach partition per day partition)
--   delete from schema_migrations where version = 332;

set max_parallel_maintenance_workers = 0;
set maintenance_work_mem = '64MB';

-- 1. statistics
create statistics if not exists public.charging_points_evse_norm_expr
  on (upper(translate(evse_id, '*-'::text, ''::text))) from public.charging_points;
create statistics if not exists public.charging_points_publishable
  on (coalesce(confidentiality, 'noRestriction'::text)) from public.charging_points;
create statistics if not exists public.charging_sites_publishable
  on (coalesce(confidentiality, 'noRestriction'::text)) from public.charging_sites;
analyze public.charging_points;
analyze public.charging_sites;

-- 2. lorry_rule positions
select format('drop index concurrently if exists public.%I', i.relname)
  from pg_class i
  join pg_index x on x.indexrelid = i.oid
 where i.relnamespace = 'public'::regnamespace
   and not x.indisvalid
   and i.relname in ('lorry_long_network_contract_geography', 'lorry_sevas_contract_geography',
                     'lorry_ivm_contract_geography', 'lorry_hb_contract_geography', 'lorry_city_contract_geography')
\gexec

create index concurrently if not exists lorry_long_network_contract_geography
  on public.lorry_long_network using gist (((geom::geometry)::geography)) where closed_at is null;
create index concurrently if not exists lorry_sevas_contract_geography
  on public.lorry_sevas using gist (((geom::geometry)::geography)) where closed_at is null;
create index concurrently if not exists lorry_ivm_contract_geography
  on public.lorry_ivm using gist (((geom::geometry)::geography)) where closed_at is null;
create index concurrently if not exists lorry_hb_contract_geography
  on public.lorry_hb using gist (((geom::geometry)::geography)) where closed_at is null;
create index concurrently if not exists lorry_city_contract_geography
  on public.lorry_city using gist (((geom::geometry)::geography)) where closed_at is null;

-- 3. unused tick indexes
begin;
set local lock_timeout = '5s';
drop index if exists public.delfi_siri_et_calls_stop;
drop index if exists public.vbn_siri_et_calls_stop;
commit;

reset maintenance_work_mem;
reset max_parallel_maintenance_workers;
