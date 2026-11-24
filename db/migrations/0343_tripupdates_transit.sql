-- tripupdates answers for transit.
--
-- tripupdates is the DELFI GTFS-RT Trip Updates feed (register row
-- delfi_rt_tu, CC BY-SA). Its key matches none of the domain patterns of
-- contract_source_domains but the catch-all: the transit pattern (60) asks
-- for delfi, gtfs, _rt$ and the like, and 'tripupdates' carries none of
-- them. So the view gave it roads (90), and a transit read of the API's
-- licence gate, which asks for the families of the transit domain, did not
-- see the feed behind every live departure. Production, read only,
-- 2026-11-24: contract_source_domains holds 0342's ten rows, the last the
-- catch-all '.' -> roads (90); tripupdates resolves to delfi_rt_tu and to
-- roads. A row '^tripupdates$' -> transit at 65 maps that key alone, the
-- way 0342 mapped h2_mobility; no other contract source changes domain
-- (the db test compares the domain of every source before and after, and
-- a read-only select of production found exactly one row that moves).
--
-- Only contract_source_domains is replaced, with 0342's rows and the new
-- one. create or replace view keeps the view's columns, owner, grants and
-- comment; it takes an ACCESS EXCLUSIVE lock on the view, the readers hold
-- it for one statement, lock_timeout bounds the wait. Idempotent: the view
-- is replaced.
--
-- rollback:
--   re-run 0342's create or replace view public.contract_source_domains;
--   delete from schema_migrations where version = 343;
--   (a production applied by hand has no schema_migrations row 343 until
--   the release migrator runs, which then records it.)
set local lock_timeout = '5s';

create or replace view public.contract_source_domains as
select t.priority, t.pattern, t.domain
  from (values
    (10, '^viafrei_rules$', 'rules'),
    (15, '^viafrei_watch$', 'service'),
    (20, '^(dwd($|_)|mobilithek_roadweather_)', 'weather'),
    (30, '(afir|ocpdb|tankerkoenig|h2_stations|hydrogen|emobility|charg|bnetza_lsr)', 'energy'),
    (35, '^h2_mobility$', 'energy'),
    (40, '(park|_pls$|_pr_|truckpark|toll_collect_sid|trk_lkw|reisebus|lieferzonen)', 'parking'),
    (50, '^(geonames|destatis_.*|bkg_.*|osm|osm_streets|ags_.*)$', 'places'),
    (55, '(^db_fasta$|aufzug|lifts|^openstation_|^bfrk_)', 'accessibility'),
    (60, '(delfi|^db_|gtfs|siri|_rt$|^vbb|^vrn|flix|bfrk|haltestellen|lifts|openstation|mvv_|vdv|streckennetz|underground|^vbn_|^gbfs_)', 'transit'),
    (65, '^tripupdates$', 'transit'),
    (90, '.', 'roads')
  ) as t(priority, pattern, domain);
