-- Two gaps of the source register the API's licence gate reads (0312).
--
-- 1. h2_mobility answers for energy. Its key matches none of the domain
--    patterns but the catch-all, so contract_source_domains gave it roads,
--    and the API's hydrogen read, which asks for the families of the energy
--    domain, found none: every hydrogen answer was empty. Production, read
--    only, 2026-11-24: contract_source_domains has 9 rows, the last the
--    catch-all '.' -> roads (90); h2_mobility (register row
--    mobilithek_h2_stations, CC BY 4.0, all three use classes) holds the 65
--    rows of hydrogen_stations. A row '^h2_mobility$' -> energy at 35 maps
--    that key alone; no other contract source changes domain (the db test
--    compares the mapping of every source before and after).
--
-- 2. Thirteen feeds have no register row. A feed's register row is the one
--    its catalogue licence id names, and the ingestor writes a licence
--    code there for its sources (odbl-1.0, cc0-1.0, dl-de-by-2.0), which
--    names no register row (and cannot: a register id has no '-' or '.').
--    So register_id was null, use_classes '{}', and the gate refused them as
--    unreviewed: "partial" on every transit and facilities answer, the road
--    families dropped from roads answers. feed_catalog is rewritten by the
--    ingestor on every run, so the link is not written there: the view
--    carries a feed -> register row list, and a listed feed resolves to its
--    listed row before its licence id. Production, read only, 2026-11-24
--    (licence label and attribution as feed_catalog holds them, the data
--    steward's rulings of 2026-11-13 in the platform's register and the
--    ingestor's source files):
--      flix-agencies, flix-stops, flix-routes, flix-trips, flix-stop-times,
--      flix-service-dates, flix-trip-updates   ODbL 1.0  -> flix_transit (0309)
--      bochum-baustellen                       CC0 1.0   -> bochum_baustellen
--      rostock-baustellen                      CC0 1.0   -> rostock_baustellen
--      bonn-messorte                           CC0 1.0   -> bonn_messorte
--      norderstedt-baustellen                  dl-de/by-2-0 -> norderstedt_baustellen
--      hannover-routenempfehlungen             ODbL 1.0  -> hannover_routenempfehlungen
--      stuttgart-strategisches-routing         dl-de/by-2-0 -> stuttgart_strategisches_routing
--    The six new rows follow 0309: attribution verbatim, the dataset or
--    offer page as source_url, the change marker the attribution states;
--    CC0 and dl-de/by-2-0 give all three use classes (as CC BY 4.0), ODbL
--    all three with share-alike on the database, exactly as the OSM rows
--    and flix_transit; verified_on the ruling's date, register_version the
--    register's (2026-11-14), so no other family's version moves.
--    A new row is a feed's own: it is not listed again as a register-only
--    source (the third branch); flix_transit, shared by seven feeds, stays
--    as it was.
--
-- Idempotent: the inserts skip a row already there, the views are replaced.
-- create or replace view takes an ACCESS EXCLUSIVE lock on the view; the
-- readers hold it for one statement, lock_timeout bounds the wait.
--
-- rollback:
--   re-run the create view statements of 0312 for public.contract_source_domains
--   and public.contract_sources as create or replace view;
--   delete from public.source_register where source_id in ('bochum_baustellen',
--     'rostock_baustellen', 'bonn_messorte', 'norderstedt_baustellen',
--     'hannover_routenempfehlungen', 'stuttgart_strategisches_routing');
--   delete from schema_migrations where version = 342;
set local lock_timeout = '5s';

insert into public.source_register (source_id, attribution_text, source_url, licence_label, share_alike, share_alike_database, changes_statement, use_classes, consumer_answers_only, no_redistribution, verified_on, register_version) values
  ('bochum_baustellen', 'Baustellen: Stadt Bochum, CC0 1.0 (https://opendata.ruhr/dataset/bochum-baustellen)', 'https://opendata.ruhr/dataset/bochum-baustellen', 'CC0 1.0', false, false, null, array['consumer', 'non_commercial', 'commercial'], false, false, '2026-11-13'::date, '2026-11-14'::date),
  ('rostock_baustellen', 'Baustellen: Hanse- und Universitätsstadt Rostock, CC0 1.0 (https://www.opendata-hro.de/dataset/baustellen)', 'https://www.opendata-hro.de/dataset/baustellen', 'CC0 1.0', false, false, null, array['consumer', 'non_commercial', 'commercial'], false, false, '2026-11-13'::date, '2026-11-14'::date),
  ('bonn_messorte', 'Messorte der Geschwindigkeitsüberwachung Bonn, abgeleitet aus „Bußgelder fließender Verkehr 2024“: Datenquelle: Open Data Stadt Bonn (Eigene Berechnungen eingefügt), CC0 1.0', 'https://opendata.bonn.de/dataset/bu%C3%9Fgelder-flie%C3%9Fender-verkehr-2024', 'CC0 1.0', false, false, 'Eigene Berechnungen eingefügt', array['consumer', 'non_commercial', 'commercial'], false, false, '2026-11-13'::date, '2026-11-14'::date),
  ('norderstedt_baustellen', 'Baustellen: Herausgeber: Stadtverwaltung Norderstedt, Datenlizenz Deutschland – Namensnennung – Version 2.0 (www.govdata.de/dl-de/by-2-0), bearbeitet (https://www.govdata.de/daten/-/details/baustelleninformation)', 'https://www.govdata.de/daten/-/details/baustelleninformation', 'dl-de/by-2-0', false, false, 'bearbeitet', array['consumer', 'non_commercial', 'commercial'], false, false, '2026-11-13'::date, '2026-11-14'::date),
  ('hannover_routenempfehlungen', 'Routenempfehlungen Hannover: Landeshauptstadt Hannover – Fachbereich Tiefbau – Sachgebiet Verkehrsmanagement via Mobilithek — enthält Daten aus „Routenempfehlungen der Verkehrsmanagement-Zentrale Hannover“, Open Database License 1.0 (opendatacommons.org/licenses/odbl/1-0/), bearbeitet', 'https://mobilithek.info/offers/1014168549190426624', 'ODbL 1.0', true, true, 'bearbeitet', array['consumer', 'non_commercial', 'commercial'], false, false, '2026-11-13'::date, '2026-11-14'::date),
  ('stuttgart_strategisches_routing', 'Strategisches Routing Region Stuttgart: D BW Verband Region Stuttgart via Mobilithek, Datenlizenz Deutschland – Namensnennung – Version 2.0 (www.govdata.de/dl-de/by-2-0), Strategisches Routing in Region Stuttgart (MDM ID 616604813439705088), Daten verändert', 'https://mobilithek.info/offers/616604813439705088', 'dl-de/by-2-0', false, false, 'Daten verändert', array['consumer', 'non_commercial', 'commercial'], false, false, '2026-11-13'::date, '2026-11-14'::date)
on conflict (source_id) do nothing;

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
    (90, '.', 'roads')
  ) as t(priority, pattern, domain);

create or replace view public.contract_sources as
with feed_register (feed_key, source_id) as (
  values
    ('flix-agencies', 'flix_transit'),
    ('flix-stops', 'flix_transit'),
    ('flix-routes', 'flix_transit'),
    ('flix-trips', 'flix_transit'),
    ('flix-stop-times', 'flix_transit'),
    ('flix-service-dates', 'flix_transit'),
    ('flix-trip-updates', 'flix_transit'),
    ('bochum-baustellen', 'bochum_baustellen'),
    ('rostock-baustellen', 'rostock_baustellen'),
    ('bonn-messorte', 'bonn_messorte'),
    ('norderstedt-baustellen', 'norderstedt_baustellen'),
    ('hannover-routenempfehlungen', 'hannover_routenempfehlungen'),
    ('stuttgart-strategisches-routing', 'stuttgart_strategisches_routing')
)
select c.feed_key                                       as source_ref,
       g.source_id                                      as register_id,
       c.display_name                                   as publisher_name,
       coalesce(c.licence_label, g.licence_label, c.licence_id) as licence_code,
       coalesce(g.attribution_text, c.attribution)      as attribution_text,
       c.offer_url                                      as terms_url,
       c.licence_id = 'toll_collect_sid'
         or c.feed_key ~ '(truckpark_sid|toll_collect_sid)' as acceptance_required,
       coalesce(c.cadence_s, c.declared_cadence_s)      as cadence_s
  from public.feed_catalog c
  left join feed_register l on l.feed_key = c.feed_key
  left join public.source_register g on g.source_id = coalesce(l.source_id, c.licence_id)
union all
select r.source_id, g.source_id, coalesce(r.publisher, r.display_name), coalesce(r.licence_label, g.licence_label),
       coalesce(g.attribution_text, r.attribution), r.licence_url, false, r.cadence_s
  from public.registered_sources r
  left join public.source_register g on g.source_id = r.source_id
 where not exists (select from public.feed_catalog c where c.feed_key = r.source_id)
union all
select g.source_id, g.source_id, g.attribution_text, g.licence_label, g.attribution_text, g.source_url,
       g.source_id = 'toll_collect_sid', null
  from public.source_register g
 where not exists (select from public.feed_catalog c where c.feed_key = g.source_id or c.licence_id = g.source_id)
   and not exists (select from public.registered_sources r where r.source_id = g.source_id)
   and not exists (select from feed_register l where l.source_id = g.source_id and replace(l.feed_key, '-', '_') = g.source_id);
