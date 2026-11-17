-- The read contract's views read the platform's tables (#29, owner decisions
-- 2026-11-16). 0307 published every view of contract 0.3 empty; this file
-- replaces all 31 of them with a mapping onto the tables the workers write today
-- (the public schema; the domains tables stay empty until the ingestor
-- cutover, and a later migration adds their merged views).
--
-- The columns of 0307 keep their names, order and types (create or replace
-- view refuses anything else). After them each view APPENDS the licence
-- envelope, so a query the API compiled against contract 0.2 still reads it:
--   source_ref          the source key, on the views 0.2 left without one
--                       (feed_catalog.feed_key, or the register id a table
--                       carries itself);
--   source_refs         text[]: every source that contributed to an entity a
--                       caller may see merged (one, until the domains merge);
--   display_class       open | consumer_only | no_redistribution | gated |
--                       withhold: what a caller may show a person. withhold
--                       = a row its publisher marked confidential (DATEX II
--                       confidentiality other than noRestriction) or a
--                       charging site its name marks private;
--   audience            public | own: 'own' rows are for ViaFrei's own web
--                       and MCP keys only (Tankerkoenig fuel, Polizei Hamburg
--                       and BW Landesmeldestelle messages); the Autobahn GmbH
--                       API and the Toll Collect SID are public (owner
--                       decisions 2026-11-16);
--   confidentiality     the publisher's marking, raw, where the table has it;
--   terms_gate          the terms the REQUEST must accept, at that version,
--                       before the row is served (sid-terms-1, contract.terms
--                       holds the text): a per-request acceptance like the
--                       site's click and MCP's elicitation, never a property
--                       of the key (owner decision 2026-11-16);
--   hold_reason         set when no request may read the row at all; no
--                       source is held today;
--   origin_restriction  a condition of the row's origin (bw_rvwd,
--                       polizei_hamburg) whose note the caller shows;
--   access_private, operator_is_person   on charging_site.
-- The API enforces all of it from the key record; the views only state it.
-- The rules per source are public.contract_source_rules, from the data
-- steward's rulings of 2026-11-16.
--
-- Held back here, for reasons that are not a caller's to decide: a row WE
-- retracted (deleted_at: hidden from every read of the platform); a row with
-- no location where the contract's location is NOT NULL; and every row of a
-- source no use of which is permitted (CC BY-NC-SA Tankerkoenig history,
-- unruled or unlicensed offers: contract_source_rules.excluded).
--
-- A column with no honest source is NULL and named in the view's comment.
-- source_note, rule_topic, rule_statement and message_coverage read the seed
-- tables of 0309, 0310 and 0311.
--
-- Views read their tables with their owner's rights, never api_reader's, so
-- api_reader keeps its grants on contract alone (0307). No view calls a
-- function that reads a table with the caller's rights: the Autobahn payload
-- is resolved inline, as autobahn_raw_resolve() does, and the one function
-- that reads a table, contract_stop_place_of(), is a security definer.
--
-- rollback: re-run the create view statements of 0307 as create or replace
-- view after dropping the appended columns, i.e. drop and recreate each
-- replaced view from 0307 (then grant select on all tables in schema
-- contract to api_reader), then drop view contract.terms, contract.departure,
-- contract.hydrogen_station, contract.speed_camera, contract.sharing_station,
-- contract.sharing_station_status, contract.sharing_vehicle, contract.poi,
-- contract.address, contract.service_alert, contract.transit_punctuality,
-- contract.street_bay,
-- functions public.contract_road_line(text), public.contract_transport_mode(integer),
-- public.contract_stop_place_of(text), public.contract_search_fold(text),
-- public.contract_sources, public.contract_source_domains,
-- public.contract_source_rules; drop trigger autobahn_sweeps_note on
-- public.autobahn_events, drop function public.autobahn_sweeps_note(),
-- drop table public.autobahn_sweeps;
--   delete from schema_migrations where version = 312;

-- create or replace view takes an ACCESS EXCLUSIVE lock on the view.
set local lock_timeout = '5s';

-- ------------------------------------------------------------- the fold

-- The search form of a name, as viafrei-api's transit.Fold writes a query:
-- lower case, ä/ö/ü spelled ae/oe/ue and ß ss, every other diacritic of the
-- Latin letters a German name carries dropped, and everything but letters and
-- digits removed. "Köln Hbf", "koeln hbf" and "KOELN-HBF" fold alike.
-- contract.stop_place and contract.place_alias carry it as search_fold, and
-- 0313 indexes it (trigram) for the API's substring search.
create function public.contract_search_fold(t text) returns text
  language sql immutable strict parallel safe
  return regexp_replace(
           translate(replace(replace(replace(replace(replace(lower(t), 'ä', 'ae'), 'ö', 'oe'), 'ü', 'ue'), 'ß', 'ss'), 'ẞ', 'ss'),
                     'àáâãåāăąçćčĉèéêëēėęěìíîïīįñńňòóôõøōśšşùúûūůűýÿźżžłřğďť',
                     'aaaaaaaacccceeeeeeeeiiiiiinnnoooooosssuuuuuuyyzzzlrgdt'),
           '[^[:alnum:]]', '', 'g');
comment on function public.contract_search_fold(text) is
  'The search form of a name (lower case, umlauts and ß spelled out, other diacritics dropped, letters and digits only), as viafrei-api folds a query.';

-- The contract stop_place of a DHID-bearing id as the station feeds write it
-- ("dhid:de:05315:11201:EdB", "de:05315:11201", a DB station's IFOPT): the
-- DELFI timetable's stop of that DHID, else its first parentless stop filed
-- under it (KVB names a Haltestelle DELFI keeps no parent for); NULL when the
-- timetable holds neither, never an id that names no stop_place. Security
-- definer: a view calls a function with its reader's rights, and api_reader
-- reads no platform table.
create function public.contract_stop_place_of(ref text) returns text
  language sql stable strict parallel safe security definer set search_path = pg_catalog, public
  return (select '1:' || s.id from public.stops s
           where s.gtfs_feed_key = 1 and s.deleted_at is null
             and (s.id = substring(ref from '^(?:dhid:)?([a-z]{2}:[0-9]{5}:[0-9]+)')
                  or s.id like substring(ref from '^(?:dhid:)?([a-z]{2}:[0-9]{5}:[0-9]+)') || ':%')
             and (s.location_type = 1 or (s.location_type = 0 and s.parent_id is null))
           order by s.id = substring(ref from '^(?:dhid:)?([a-z]{2}:[0-9]{5}:[0-9]+)') desc, s.id
           limit 1);
comment on function public.contract_stop_place_of(text) is
  'The contract stop_place_id of a station feed''s DHID-bearing id: the DELFI stop of that DHID, else the first parentless stop under it, else NULL.';

create function public.contract_transport_mode(route_type integer) returns text
  language sql immutable strict parallel safe
  return case
           when route_type = 109 then 'sbahn'
           when route_type = 2 or route_type between 100 and 199 then 'rail'
           when route_type = 1 or route_type between 400 and 405 then 'subway'
           when route_type = 0 or route_type between 900 and 906 then 'tram'
           when route_type in (3, 11, 800) or route_type between 200 and 209 or route_type between 700 and 716 then 'bus'
           when route_type = 4 or route_type between 1000 and 1021 or route_type = 1200 then 'ferry'
           else 'other'
         end;
comment on function public.contract_transport_mode(integer) is
  'The contract transport_mode of a GTFS route_type (basic and extended), as contract.transit_line and contract.departure name it.';

-- ------------------------------------------------------------ the rules

create view public.contract_source_rules as
select t.priority, t.pattern, t.excluded, t.audience, t.display_class, t.terms_gate, t.hold_reason, t.origin_restriction
  from (values
    (10, '(tankerkoenig_hist|truckpark_occ|(^|_)ris_|park_by_lkw_dyn|enerando_stat)', true, null, null, null, null, null),
    (20, '(truckpark_sid|toll_collect_sid)', false, 'public', 'gated', 'sid-terms-1', null, null),
    (30, 'tankerkoenig', false, 'own', 'no_redistribution', null, null, null),
    (40, '(^|_)traffic_bw$', false, 'own', 'consumer_only', null, null, 'bw_rvwd'),
    (50, '(traffic_hamburg|polizei_hamburg)', false, 'own', 'consumer_only', null, null, 'polizei_hamburg'),
    (70, '(eliso|(^|_)elu_|chargepool|park_sh_truck|trucklounge|christophorus|bosch)', false, 'public', 'consumer_only', null, null, null)
  ) as t(priority, pattern, excluded, audience, display_class, terms_gate, hold_reason, origin_restriction);
comment on view public.contract_source_rules is 'The licence envelope of the contract views (0312), per source key: the first rule by priority whose pattern matches the key applies; no match = public, open. excluded = no row of the source is mapped. From the data steward''s rulings and the owner''s decisions of 2026-11-16 (the Autobahn GmbH API is public and open; the SID is public behind a per-request terms gate); a change is a migration.';

-- ---------------------------------------------------------------- register

-- The domain a source answers for: the feature whose question its rows answer
-- (the API's gate asks for the families of one domain). First match by
-- priority on the source key; everything else is a road source.
create view public.contract_source_domains as
select t.priority, t.pattern, t.domain
  from (values
    (10, '^viafrei_rules$', 'rules'),
    (15, '^viafrei_watch$', 'service'),
    (20, '^(dwd($|_)|mobilithek_roadweather_)', 'weather'),
    (30, '(afir|ocpdb|tankerkoenig|h2_stations|hydrogen|emobility|charg|bnetza_lsr)', 'energy'),
    (40, '(park|_pls$|_pr_|truckpark|toll_collect_sid|trk_lkw|reisebus|lieferzonen)', 'parking'),
    (50, '^(geonames|destatis_.*|bkg_.*|osm|osm_streets|ags_.*)$', 'places'),
    (55, '(^db_fasta$|aufzug|lifts|^openstation_|^bfrk_)', 'accessibility'),
    (60, '(delfi|^db_|gtfs|siri|_rt$|^vbb|^vrn|flix|bfrk|haltestellen|lifts|openstation|mvv_|vdv|streckennetz|underground|^vbn_|^gbfs_)', 'transit'),
    (90, '.', 'roads')
  ) as t(priority, pattern, domain);
comment on view public.contract_source_domains is 'The domain of each contract source (0312): the first pattern by priority that matches the source key. A change is a migration.';

-- Every source the platform attributes: the feeds of feed_catalog, the
-- ingestor's sources not in it, and the register's other sources (static
-- reference data, our own content). A feed's register row is the one its
-- catalogue licence id names (the platform resolves it the same way); it
-- states the attribution, the conditions and the review.
create view public.contract_sources as
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
  left join public.source_register g on g.source_id = c.licence_id
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
   and not exists (select from public.registered_sources r where r.source_id = g.source_id);
comment on view public.contract_sources is 'The sources contract.source, publisher and licence publish (0312): feed_catalog, then the ingestor''s registered sources, then the register''s other sources, one row per key. publisher_name of a register-only source is its attribution line (the register names no publisher apart from it).';

-- website: the page the register names for the source (its publisher's
-- dataset or offer page), else the catalogue's offer page.
create or replace view contract.publisher as
select s.source_ref                    as publisher_id,
       s.publisher_name                as display_name,
       coalesce(g.source_url, s.terms_url) as website
  from public.contract_sources s
  left join public.source_register g on g.source_id = s.register_id
  left join lateral (select k.excluded from public.contract_source_rules k where s.source_ref ~ k.pattern order by k.priority limit 1) k on true
 where not coalesce(k.excluded, false) and s.publisher_name is not null;

create or replace view contract.source as
with s as (
  select s.source_ref                                       as source_ref,
         d.domain                                           as domain,
         s.source_ref                                       as publisher_id,
         s.licence_code                                     as licence_code,
         s.attribution_text                                 as attribution_text,
         g.changes_statement                                as changes_statement,
         s.terms_url                                        as terms_url,
         -- Share-alike (CC BY-SA on the work, ODbL on the database): our
         -- adaptation is offered free of charge on request to the contact the
         -- Impressum names (the platform's offer text says so per database).
         case when g.share_alike or s.licence_code ~* '(BY-SA|ODbL|Open Database License)'
              then 'https://viafrei.de/impressum' end       as share_alike_offer_url,
         s.acceptance_required                              as acceptance_required,
         -- A source the rulings restrict (consumer_only, no_redistribution,
         -- gated) keeps only the consumer class of its licence's classes.
         case when coalesce(k.display_class, 'open') = 'open' then coalesce(g.use_classes, '{}')
              else array(select u from unnest(coalesce(g.use_classes, '{}')) u where u = 'consumer') end as use_classes,
         -- Staleness (owner decision 2026-11-16): only a source with a known
         -- cadence is ever judged stale, at 3 x its cadence; a source with no
         -- fixed update interval (static reference data, our own content) is
         -- NEVER stale and carries its as-of time (source_freshness) alone:
         -- both columns are NULL.
         coalesce(s.cadence_s, f.cadence_s)                 as freshness_target_s,
         3 * coalesce(s.cadence_s, f.cadence_s)             as stale_after_s,
         g.verified_on                                      as review_signed_on,
         coalesce(g.register_version, (select max(v.register_version) from public.source_register v)) as register_version,
         k.excluded, k.display_class, k.audience, k.terms_gate, k.hold_reason, k.origin_restriction
    from public.contract_sources s
    left join public.source_register g on g.source_id = s.register_id
    left join lateral (select max(x.cadence_s) as cadence_s from control.data_status x where x.key = s.source_ref) f on true
    left join lateral (select d.domain from public.contract_source_domains d where s.source_ref ~ d.pattern order by d.priority limit 1) d on true
    left join lateral (select k.* from public.contract_source_rules k where s.source_ref ~ k.pattern order by k.priority limit 1) k on true
)
select s.source_ref, s.domain, s.publisher_id, s.licence_code, s.attribution_text, s.changes_statement, s.terms_url,
       s.share_alike_offer_url, s.acceptance_required, s.use_classes, s.freshness_target_s, s.stale_after_s,
       s.review_signed_on, s.register_version,
       coalesce(s.display_class, 'open')    as display_class,
       coalesce(s.audience, 'public')       as audience,
       s.terms_gate                         as terms_gate,
       s.hold_reason                        as hold_reason,
       s.origin_restriction                 as origin_restriction
  from s
 where not coalesce(s.excluded, false)
   -- A source whose licence was never read is not published.
   and coalesce(s.licence_code, '') !~* '^pending';

-- One row per label a published source carries (contract.source, so an
-- excluded or unlicensed source names none). licence_url: the label's row in
-- public.licence_texts (0309), else the canonical text of a CC, ODbL,
-- Datenlizenz Deutschland or GeoNutzV label, else the source page of the one
-- source that carries the label, else the register's.
create or replace view contract.licence as
with labels as (
  select s.licence_code as code from contract.source s where s.licence_code is not null
  union
  select t.licence_label from public.licence_texts t
)
select l.code                                                        as licence_code,
       l.code                                                        as licence_name,
       coalesce(
         (select t.url from public.licence_texts t where t.licence_label = l.code),
         case
           when l.code ~* '^CC BY-SA 4\.0'  then 'https://creativecommons.org/licenses/by-sa/4.0/'
           when l.code ~* '^CC BY 4\.0'     then 'https://creativecommons.org/licenses/by/4.0/'
           when l.code ~* '^CC BY 3\.0 DE'  then 'https://creativecommons.org/licenses/by/3.0/de/'
           when l.code ~* '(^CC0|Creative Commons Zero)' then 'https://creativecommons.org/publicdomain/zero/1.0/'
           when l.code ~* '(ODbL|Open Database License)' then 'https://opendatacommons.org/licenses/odbl/1-0/'
           when l.code ~* '(dl-de/zero|Datenlizenz Deutschland – Zero)' then 'https://www.govdata.de/dl-de/zero-2-0'
           when l.code ~* '(dl-de/by|Datenlizenz Deutschland – Namensnennung)' then 'https://www.govdata.de/dl-de/by-2-0'
           when l.code ~* 'GeoNutzV'         then 'https://www.gesetze-im-internet.de/geonutzv/'
         end,
         (select min(s.terms_url) from contract.source s where s.licence_code = l.code
           having count(distinct s.terms_url) = 1),
         (select min(g.source_url) from public.source_register g where g.licence_label = l.code)) as licence_url,
       case
         when l.code ~* '(CC0|Creative Commons Zero|zero-2-0|Datenlizenz Deutschland – Zero)' then 'public_domain'
         when l.code ~* '(BY-SA|ODbL|Open Database License)' then 'share_alike'
         when l.code ~* '(CC BY|Namensnennung|by-2-0|GeoNutzV)' then 'attribution'
         else 'terms'
       end                                                           as licence_category,
       l.code ~* '(BY-SA|ODbL|Open Database License)'                as share_alike,
       not (l.code ~* '(CC0|Creative Commons Zero|zero-2-0|Datenlizenz Deutschland – Zero)') as attribution_required
  from labels l;

create or replace view contract.source_note as
select s.source_ref                         as source_ref,
       n.note_kind                          as note_kind,
       n.lang                               as lang,
       n.body                               as body
  from public.contract_sources s
  join public.source_register_notes n on n.source_id = s.register_id
  left join lateral (select k.excluded from public.contract_source_rules k where s.source_ref ~ k.pattern order by k.priority limit 1) k on true
 where not coalesce(k.excluded, false);

create or replace view contract.source_freshness as
select d.key                                                  as source_ref,
       d.last_changed_at                                      as data_as_of,
       coalesce(extract(epoch from d.last_changed_at)::bigint::text, '0') as freshness_version,
       d.held_since                                           as confirmed_at,
       d.cadence_s                                            as confirm_interval_s,
       d.paused                                               as updates_paused
  from control.data_status d
  left join lateral (select k.excluded from public.contract_source_rules k where d.key ~ k.pattern order by k.priority limit 1) k on true
 where not coalesce(k.excluded, false);

-- ------------------------------------------------------------- reference

create or replace view contract.admin_region as
select a.ags                                               as region_code,
       case a.level when 'land' then 'state' when 'kreis' then 'district' end as region_level,
       a.name                                              as name,
       a.parent_ags                                        as parent_code,
       null::geometry(MultiPolygon, 4326)                  as boundary,
       a.source_id                                         as source_ref,
       'open'::text                                        as display_class,
       'public'::text                                      as audience
  from public.ags_regions a;

create or replace view contract.place as
select g.id::text                                          as place_id,
       case g.kind
         when 'city' then 'municipality' when 'district' then 'district'
         when 'admin' then 'state' when 'station' then 'station_area'
         when 'stop' then 'station_area' when 'island' then 'locality'
         else 'other'
       end                                                 as place_kind,
       g.name                                              as name,
       st_pointonsurface(g.geom::geometry)::geometry(Point, 4326) as location,
       (select a.ags from public.ags_regions a
         where a.ags in (left(g.admin_code, 5), left(g.admin_code, 2))
         order by length(a.ags) desc limit 1)              as region_code,
       g.admin_code                                        as official_key,
       coalesce(g.rank, 0)                                 as prominence,
       g.source_id                                         as source_ref,
       g.external_id                                       as origin_key,
       null::timestamptz                                   as published_at,
       g.first_seen_at                                     as recorded_at,
       g.last_seen_at                                      as changed_at,
       g.closed_at                                         as withdrawn_at,
       array[g.source_id]                                  as source_refs,
       'open'::text                                        as display_class,
       'public'::text                                      as audience
  from public.gazetteer_places g
 where g.geom is not null;

create or replace view contract.place_alias as
select g.id::text as place_id, g.name as label, null::text as lang, 'name'::text as name_kind, public.contract_search_fold(g.name) as search_fold,
       g.source_id as source_ref, 'open'::text as display_class, 'public'::text as audience
  from public.gazetteer_places g
 where g.geom is not null
union all
select g.id::text, g.name_en, 'en', 'exonym', public.contract_search_fold(g.name_en), g.source_id, 'open', 'public'
  from public.gazetteer_places g
 where g.geom is not null and g.name_en is not null;

-- A motorway's line is the one the platform's motorway map draws (ingest
-- analysis motorway-entries: orderedChains; steward M3 and S7: the BASt LCL
-- alone, never OpenStreetMap): the road's LCL points (motorway_points_live)
-- linked by pos_off_lcd, a link kept only to a point of the same road that is
-- not the point itself. A chain starts at each point no link reaches, in
-- ascending location code, and runs until it meets a point already used;
-- what is left lies on a cycle and is walked from its smallest code. One
-- LineString per chain: the line breaks where the chain breaks, and no
-- segment is invented across a gap. A chain of one point draws no line and is
-- left out. The chains keep the order of their first location code (the map
-- draws each apart, so their order draws nothing). It reads the LCL with the
-- owner's rights, as the views do.
create function public.contract_road_line(road text) returns geometry(MultiLineString, 4326)
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare
  lcds integer[];
  links integer[];
  pts geometry[];
  nxt integer[] := '{}';
  reached boolean[];
  used boolean[];
  lines geometry[] := '{}';
  chain geometry[];
  n integer;
  i integer;
  cur integer;
  pass integer;
begin
  select array_agg(p.lcd order by p.lcd), array_agg(p.pos_off_lcd order by p.lcd), array_agg(p.geom::geometry order by p.lcd)
    into lcds, links, pts
    from public.motorway_points_live p
   where p.road = contract_road_line.road;
  n := coalesce(array_length(lcds, 1), 0);
  if n = 0 then
    return null;
  end if;
  reached := array_fill(false, array[n]);
  used := array_fill(false, array[n]);
  for i in 1 .. n loop
    nxt[i] := case when links[i] is not null and links[i] <> lcds[i] then array_position(lcds, links[i]) end;
    if nxt[i] is not null then
      reached[nxt[i]] := true;
    end if;
  end loop;
  for pass in 1 .. 2 loop
    for i in 1 .. n loop
      continue when used[i] or (pass = 1 and reached[i]);
      chain := '{}';
      cur := i;
      while cur is not null and not used[cur] loop
        used[cur] := true;
        chain := chain || pts[cur];
        cur := nxt[cur];
      end loop;
      if array_length(chain, 1) >= 2 then
        lines := lines || st_makeline(chain);
      end if;
    end loop;
  end loop;
  if array_length(lines, 1) is null then
    return null;
  end if;
  return st_setsrid(st_multi(st_collect(lines)), 4326)::geometry(MultiLineString, 4326);
end $$;
comment on function public.contract_road_line(text) is
  'The line of one motorway as the platform''s motorway map draws it: its BASt LCL chains linked by pos_off_lcd, one LineString per chain, no segment across a gap; NULL when the LCL holds no chain of two points.';

-- autobahn_roads is the Autobahn GmbH API's road list: its rule applies. The
-- geometry is the BASt LCL's (bast_lcl), credited in source_refs.
create or replace view contract.road as
select r.road                                  as road_ref,
       'motorway'::text                        as road_class,
       r.road                                  as name,
       null::numeric(6,1)                      as length_km,
       l.line::geometry(MultiLineString, 4326) as geometry,
       null::text[]                            as states,
       'autobahn'::text                        as source_ref,
       coalesce(k.display_class, 'open')       as display_class,
       coalesce(k.audience, 'public')          as audience,
       case when l.line is null then array['autobahn'] else array['autobahn', 'bast_lcl'] end as source_refs
  from public.autobahn_roads r
  cross join lateral (select public.contract_road_line(r.road) as line) l
  left join lateral (select k.* from public.contract_source_rules k where 'autobahn' ~ k.pattern order by k.priority limit 1) k on true;

-- tmc_locations names no source key of its own (BASt LCL, lcl_version only).
-- state_code: the location list names no Land, so it is derived: the Land
-- (the first two digits of the AGS) of the nearest municipality point of the
-- BKG administrative units (gazetteer_places, source bkg_gvisys), one probe of
-- that set's own index (0313). A junction within a few hundred metres of a
-- Land border may take its neighbour's Land.
create or replace view contract.junction as
select t.cid || ':' || t.tabcd || ':' || t.lcd                as junction_id,
       t.road_number                                          as road_ref,
       t.junction_no                                          as number,
       t.name                                                 as name,
       case t.stcd when 1 then 'interchange' when 2 then 'triangle' else 'junction' end as junction_kind,
       null::numeric(6,1)                                     as chainage_km,
       t.geom::geometry(Point, 4326)                          as location,
       (select left(g.admin_code, 2) from public.gazetteer_places g
         where g.source_id = 'bkg_gvisys' and g.kind = 'city' and g.geom is not null
         order by g.geom::geometry <-> t.geom::geometry limit 1) as state_code,
       'bast_lcl'::text                                       as source_ref,
       'open'::text                                           as display_class,
       'public'::text                                         as audience
  from public.tmc_locations t
 where t.cid = 58 and t.tabcd = 1 and t.tcd = 1
   and t.road_number ~ '^A[1-9][0-9]{0,2}$'
   and t.geom is not null and t.name is not null;

-- ----------------------------------------------------------------- roads

-- The newest sweep of each Autobahn road and event kind, kept by the insert
-- itself: one row per (road, kind), moved forward by a statement trigger on
-- autobahn_events (a sweep is one insert statement per road and kind). The
-- contract reads "the events of the newest sweep" off it with one index probe
-- per row, where a probe of the tick table per road and kind walked a whole
-- day of a road's ticks for a kind its newest sweeps did not carry (1.7 to
-- 2.7 s at production volume, over the 2 s read budget). Never moved back:
-- a late insert of an older tick leaves the newer sweep standing.
create table public.autobahn_sweeps (
  road        text        not null,
  kind        text        not null,
  observed_at timestamptz not null,
  primary key (road, kind)
);
comment on table public.autobahn_sweeps is
  'The instant of the newest Autobahn GmbH sweep per road and event kind, kept by trigger autobahn_sweeps_note on autobahn_events; contract.traffic_event reads its events (#29).';

create function public.autobahn_sweeps_note() returns trigger
  language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  insert into public.autobahn_sweeps as s (road, kind, observed_at)
  select n.road, n.kind, max(n.observed_at) from new_rows n group by n.road, n.kind
  on conflict (road, kind) do update set observed_at = excluded.observed_at
   where s.observed_at < excluded.observed_at;
  return null;
end $$;
revoke all on function public.autobahn_sweeps_note() from public;

create trigger autobahn_sweeps_note after insert on public.autobahn_events
  referencing new table as new_rows for each statement execute function public.autobahn_sweeps_note();

-- The sweeps already stored: the newest instant of the last day per road and
-- kind, one probe of autobahn_events_road each.
insert into public.autobahn_sweeps (road, kind, observed_at)
select x.road, x.kind, x.at
  from (select r.road, k.kind,
               (select e.observed_at from public.autobahn_events e
                 where e.road = r.road and e.kind = k.kind and e.observed_at > now() - interval '1 day'
                 order by e.observed_at desc limit 1) as at
          from public.autobahn_roads r
         cross join (select distinct e.kind from public.autobahn_events e
                      where e.observed_at > now() - interval '1 day') k) x
 where x.at is not null;

-- Autobahn GmbH: the events of the newest sweep of each road and kind (an
-- event that left the sweep is no longer current); its payload, where the
-- tick stores none, is the newest same-day tick of the same item with the
-- same hash, exactly as autobahn_raw_resolve() reads it.
-- DATEX II (Mobilithek): every row of road_events we did not retract, with
-- the provider's own end as withdrawn_at and its marking as confidentiality.
-- event_kind follows the platform's road vocabulary (ingest analysis
-- road-now: roadNowKindOf): an Autobahn warning is a jam only with a standing
-- or crawling traffic type; a DATEX roadOrCarriagewayOrLaneManagement record
-- is a restriction, not a closure (its only recorded type is lanesDeviated);
-- a police message's own German type names a closure (Sperrung) or an
-- accident (Unfall). severity is the platform's ranking band (bandOf) on the
-- API's scale: a closed road (an Autobahn closure, an item the provider marks
-- blocked, a Sperrung) road_closed; an accident, a jam of ten minutes or more
-- (LONG_JAM_SECONDS) and a closed entry or exit major; roadworks, the band
-- between the long and the short jam, lane_closed; a shorter or unmeasured jam
-- and a restriction minor; a hazard or the weather info; anything else other
-- (not graded).
create or replace view contract.traffic_event as
with newest as (
  -- The newest sweep of the last day per road and event kind (autobahn_sweeps).
  select s.road, s.kind, s.observed_at as at
    from public.autobahn_sweeps s
   where s.observed_at > now() - interval '1 day'
     and s.kind in ('warning', 'roadworks', 'closure', 'closure_entry_exit')
), autobahn as (
  select e.*,
         coalesce(e.raw, (select r.raw from public.autobahn_events r
                           where r.ext_id = e.ext_id and r.raw is not null and r.raw_hash = e.raw_hash
                             and r.observed_at <= e.observed_at
                             and r.observed_at >= date_trunc('day', e.observed_at, 'UTC')
                           order by r.observed_at desc limit 1)) as p
    from public.autobahn_events e
    join newest n on n.road = e.road and n.kind = e.kind and n.at = e.observed_at
), b as (
  select 'autobahn:' || a.ext_id                                    as event_id,
         case
           when a.kind like 'closure%' then 'closure'
           when a.kind = 'roadworks' then 'roadworks'
           when a.kind = 'warning'
                and a.abnormal_traffic_type in ('QUEUING_TRAFFIC', 'STATIONARY_TRAFFIC', 'SLOW_TRAFFIC', 'HEAVY_TRAFFIC') then 'jam'
           when a.kind = 'warning' then 'hazard'
           else 'other'
         end                                                         as event_kind,
         case
           when a.kind = 'closure' or a.p->>'isBlocked' = 'true' then 'road_closed'
           when a.kind = 'closure_entry_exit' then 'major'
           when a.kind = 'roadworks' then 'lane_closed'
           when a.kind = 'warning'
                and a.abnormal_traffic_type in ('QUEUING_TRAFFIC', 'STATIONARY_TRAFFIC', 'SLOW_TRAFFIC', 'HEAVY_TRAFFIC')
             then case when a.delay_s >= 600 then 'major' else 'minor' end
           when a.kind = 'warning' then 'info'
           else 'other'
         end                                                         as severity,
         a.road                                                      as road_ref,
         'motorway'::text                                            as road_class,
         'unknown'::text                                             as direction,
         null::text                                                  as direction_label,
         st_pointonsurface(a.geom::geometry)::geometry(Point, 4326)  as location,
         coalesce(case when a.p->>'startTimestamp' ~ '^\d{4}-\d\d-\d\dT\d\d:\d\d'
                       then (a.p->>'startTimestamp')::timestamptz end,
                  a.observed_at)                                     as valid_from,
         null::timestamptz                                           as valid_to,
         null::integer                                               as lanes_closed,
         null::integer                                               as lanes_total,
         case when a.delay_s >= 0 then a.delay_s / 60 end            as delay_min,
         null::integer                                               as affected_length_m,
         coalesce(a.title, a.kind)                                   as headline,
         (select string_agg(l.line, E'\n' order by l.n)
            from jsonb_array_elements_text(case when jsonb_typeof(a.p->'description') = 'array'
                                                then a.p->'description' end) with ordinality l(line, n)) as description,
         'de'::text                                                  as text_lang,
         a.source                                                    as source_ref,
         a.ext_id                                                    as origin_key,
         null::timestamptz                                           as published_at,
         a.observed_at                                               as recorded_at,
         a.observed_at                                               as changed_at,
         null::timestamptz                                           as withdrawn_at,
         'operator_event'::text                                      as record_class,
         a.subtitle                                                  as subtitle,
         null::text                                                  as place_text,
         case a.p->>'isBlocked' when 'true' then true when 'false' then false end as is_blocked,
         a.abnormal_traffic_type                                     as traffic_type,
         case when a.delay_s >= 0 then a.delay_s end                 as delay_s,
         null::text                                                  as confidentiality
    from autobahn a
  union all
  select 'datex:' || e.source_id || ':' || e.publication_id,
         case
           when e.event_type ~* '(maintenance|roadworks|construction)' then 'roadworks'
           when e.event_type ~* '(accident|unfall)' then 'accident'
           when e.event_type ~* 'abnormaltraffic' then 'jam'
           when e.event_type ~* '(weather|environment)' then 'weather'
           when e.event_type ~* '(closure|sperrung)' then 'closure'
           when e.event_type ~* '(speedmanagement|restriction|reroutingmanagement|carriagewayorlanemanagement|networkmanagement)' then 'restriction'
           when e.event_type ~* '(obstruction|hazard|animal|vehicle|equipment)' then 'hazard'
           else 'other'
         end,
         case
           when e.event_type ~* '(closure|sperrung)' then 'road_closed'
           when e.event_type ~* '(accident|unfall)' then 'major'
           when e.event_type ~* '(maintenance|roadworks|construction)' then 'lane_closed'
           when e.event_type ~* '(abnormaltraffic|speedmanagement|restriction|reroutingmanagement|carriagewayorlanemanagement|networkmanagement)' then 'minor'
           when e.event_type ~* '(weather|environment|obstruction|hazard|animal|vehicle|equipment)' then 'info'
           else 'other'
         end,
         e.road_number,
         case
           when e.road_number ~ '^A ?[0-9]' then 'motorway'
           when e.road_number ~ '^B ?[0-9]' then 'federal'
           when e.road_number ~ '^(L|S|St) ?[0-9]' then 'state'
           else 'other'
         end,
         'unknown',
         null,
         st_pointonsurface(e.geom)::geometry(Point, 4326),
         coalesce(e.overall_start, e.first_seen_at),
         e.overall_end,
         null, null, null, null,
         coalesce(e.event_type, 'situation'),
         null,
         'de',
         e.source_feed,
         e.publication_id,
         e.feed_ts,
         e.first_seen_at,
         e.updated_at,
         e.closed_at,
         'traffic_message',
         null, null, null, null, null,
         e.confidentiality
    from public.road_events e
   where e.deleted_at is null
)
select b.event_id, b.event_kind, b.severity, b.road_ref, b.road_class, b.direction, b.direction_label,
       b.location, b.valid_from, b.valid_to, b.lanes_closed, b.lanes_total, b.delay_min,
       b.affected_length_m, b.headline, b.description, b.text_lang, b.source_ref, b.origin_key,
       b.published_at, b.recorded_at, b.changed_at, b.withdrawn_at, b.record_class, b.subtitle,
       b.place_text, b.is_blocked, b.traffic_type, b.delay_s,
       array[b.source_ref]                                                  as source_refs,
       case when coalesce(b.confidentiality, 'noRestriction') <> 'noRestriction' then 'withhold'
            else coalesce(k.display_class, 'open') end                      as display_class,
       coalesce(k.audience, 'public')                                       as audience,
       b.confidentiality                                                    as confidentiality,
       k.origin_restriction                                                 as origin_restriction
  from b
  left join lateral (select k.* from public.contract_source_rules k where b.source_ref ~ k.pattern order by k.priority limit 1) k on true
 where not coalesce(k.excluded, false);

create or replace view contract.traffic_event_observation as
with b as (
  select 'autobahn:' || e.ext_id as event_id, e.observed_at, null::integer as version_no, e.source as source_ref, null::text as confidentiality
    from public.autobahn_events e
  union all
  select 'datex:' || t.source_id || ':' || t.publication_id, t.observed_at, t.version, t.feed_key, e.confidentiality
    from public.road_event_ticks t
    left join public.road_events e on e.source_id = t.source_id and e.publication_id = t.publication_id
   where e.deleted_at is null
)
select b.event_id, b.observed_at, b.version_no, b.source_ref,
       case when coalesce(b.confidentiality, 'noRestriction') <> 'noRestriction' then 'withhold'
            else coalesce(k.display_class, 'open') end   as display_class,
       coalesce(k.audience, 'public')                    as audience
  from b
  left join lateral (select k.* from public.contract_source_rules k where b.source_ref ~ k.pattern order by k.priority limit 1) k on true
 where not coalesce(k.excluded, false);

-- ------------------------------------------------------------------ fuel

create or replace view contract.fuel_station as
select f.id                                             as station_id,
       f.name                                           as name,
       f.brand                                          as brand,
       f.land                                           as region_code,
       f.geom::geometry(Point, 4326)                    as location,
       coalesce(f.state, 'unknown')                     as open_state,
       null::timestamptz                                as open_state_at,
       coalesce(f.source_feed, f.source)                as source_ref,
       f.id                                             as origin_key,
       f.first_seen_at                                  as recorded_at,
       coalesce(f.updated_at, f.last_seen_at)           as changed_at,
       null::timestamptz                                as withdrawn_at,
       coalesce(k.display_class, 'open')                as display_class,
       coalesce(k.audience, 'public')                   as audience,
       f.street                                         as street,
       f.house_no                                       as house_number,
       f.postcode                                       as postcode,
       f.city                                           as city,
       f.opening_times                                  as opening_times,
       f.whole_day                                      as whole_day
  from public.fuel_stations f
  left join lateral (select k.* from public.contract_source_rules k where coalesce(f.source_feed, f.source, '') ~ k.pattern order by k.priority limit 1) k on true
 where f.deleted_at is null and f.geom is not null and not coalesce(k.excluded, false);

create or replace view contract.fuel_product as
select p.code as product_code, p.label as label, p.unit as price_unit
  from public.fuel_products p;

create or replace view contract.fuel_price_observation as
select p.station_id                as station_id,
       p.product                   as product_code,
       p.observed_at               as observed_at,
       p.price::numeric(6,3)       as price,
       'EUR'::char(3)              as currency,
       p.source                    as source_ref,
       coalesce(k.display_class, 'open') as display_class,
       coalesce(k.audience, 'public')    as audience
  from public.fuel_prices p
  left join lateral (select k.* from public.contract_source_rules k where coalesce(p.source, '') ~ k.pattern order by k.priority limit 1) k on true
 where not coalesce(k.excluded, false);

-- -------------------------------------------------------------- charging

-- operator_is_person: no table states it (the loaders keep the published
-- operator name); NULL until one does.
create or replace view contract.charging_site as
select s.source_feed || ':' || s.site_id                 as site_id,
       s.name                                            as name,
       s.operator                                        as operator_name,
       case when s.access_private then 'restricted' else 'public' end as access,
       s.geom::geometry(Point, 4326)                     as location,
       s.source_feed                                     as source_ref,
       s.site_id                                         as origin_key,
       s.first_seen_at                                   as recorded_at,
       coalesce(s.updated_at, s.last_seen_at)            as changed_at,
       s.closed_at                                       as withdrawn_at,
       array[s.source_feed]                              as source_refs,
       case when coalesce(s.confidentiality, 'noRestriction') <> 'noRestriction' or s.access_private then 'withhold'
            else coalesce(k.display_class, 'open') end   as display_class,
       coalesce(k.audience, 'public')                    as audience,
       s.confidentiality                                 as confidentiality,
       s.access_private                                  as access_private,
       null::boolean                                     as operator_is_person
  from public.charging_sites s
  left join lateral (select k.* from public.contract_source_rules k where s.source_feed ~ k.pattern order by k.priority limit 1) k on true
 where s.deleted_at is null and s.geom is not null and not coalesce(k.excluded, false);

create or replace view contract.charge_point as
select coalesce(p.evse_id, p.source_feed || ':' || p.point_key) as point_id,
       p.source_feed || ':' || p.site_id                  as site_id,
       p.evse_id                                          as evse_code,
       case when p.current_type ~* '^ac' then 'ac' when p.current_type ~* '^dc' then 'dc'
            when p.current_type is not null then 'other' end as current_kind,
       p.max_power_kw::numeric(7,2)                       as power_max_kw,
       p.source_feed                                      as source_ref,
       array[p.source_feed]                               as source_refs,
       case when coalesce(p.confidentiality, 'noRestriction') <> 'noRestriction' then 'withhold'
            else coalesce(k.display_class, 'open') end    as display_class,
       coalesce(k.audience, 'public')                     as audience,
       p.confidentiality                                  as confidentiality,
       array_remove(array[
         case when p.connector_types && array['iec62196T2COMBO','iec62196T2Combo','iec62196t2combo','combo','ccs'] then 'ccs2' end,
         case when p.connector_types && array['iec62196T2','iec62196t2','type2'] then 'type2' end,
         case when p.connector_types && array['chademo','chaDemo','CHAdeMO'] then 'chademo' end,
         case when p.connector_types && array['mcs'] then 'mcs' end], null) as connectors,
       p.price_per_kwh                                    as price_per_kwh,
       p.price_adhoc_zero                                 as price_adhoc_zero,
       p.price_last_updated                               as price_updated_at,
       public.charging_register_opening_hours(p.extras)   as opening_hours_kind,
       public.charging_register_payment_card(p.extras)    as payment_card,
       public.charging_register_free_of_charge(p.extras)  as free_of_charge,
       public.charging_register_parking(p.extras)         as parking_access
  from public.charging_points p
  left join lateral (select k.* from public.contract_source_rules k where p.source_feed ~ k.pattern order by k.priority limit 1) k on true
 where p.deleted_at is null and p.site_id is not null and not coalesce(k.excluded, false);

create or replace view contract.charge_point_state_observation as
select s.evse_id                                          as point_id,
       s.observed_at                                      as observed_at,
       case
         when s.status ~* '^available$' then 'available'
         when s.status ~* '^(charging|occupied|blocked)$' then 'occupied'
         when s.status ~* '^reserved$' then 'reserved'
         when s.status ~* '^(out_?of_?order|inoperative|faulted)$' then 'out_of_order'
         when s.status is null or s.status ~* '^unknown$' then 'unknown'
         else 'other'
       end                                                as availability,
       s.source_feed                                      as source_ref,
       case when coalesce(s.confidentiality, 'noRestriction') <> 'noRestriction' then 'withhold'
            else coalesce(k.display_class, 'open') end    as display_class,
       coalesce(k.audience, 'public')                     as audience,
       s.confidentiality                                  as confidentiality
  from public.charging_point_status s
  left join lateral (select k.* from public.contract_source_rules k where s.source_feed ~ k.pattern order by k.priority limit 1) k on true
 where not coalesce(k.excluded, false);

-- --------------------------------------------------------------- parking

-- One view over the four parking families; the id's prefix keeps them apart
-- (share-alike rows are never merged into another licence's row). Every SID
-- facility says acceptance_required and its terms gate (a per-request acceptance).
create or replace view contract.parking_facility as
with f as (
  select 'p:' || id as facility_id, name, kind, operator, road, geom, false as sid, source_feed, external_id,
         first_seen_at, updated_at, last_seen_at, closed_at, confidentiality, facilities, facilities_absent
    from public.parking_facilities where deleted_at is null
  union all
  select 'bysa:' || id, name, kind, operator, road, geom, false, source_feed, external_id,
         first_seen_at, updated_at, last_seen_at, closed_at, confidentiality, '{}'::text[], '{}'::text[]
    from public.parking_facilities_bysa
  union all
  select 'odbl:' || id, name, kind, operator, road, geom, false, source_feed, external_id,
         first_seen_at, updated_at, last_seen_at, closed_at, confidentiality, '{}'::text[], '{}'::text[]
    from public.parking_facilities_odbl
  union all
  select 'sid:' || id, name, kind, null, null, geom, true, source_feed, external_id,
         first_seen_at, updated_at, last_seen_at, closed_at, confidentiality, facilities, facilities_absent
    from public.parking_facilities_sid
)
select f.facility_id                                     as facility_id,
       f.name                                            as name,
       case f.kind when 'rest_area' then 'rest_area' when 'park_and_ride' then 'park_and_ride'
                   when 'truck' then 'truck_parking' else 'other' end as parking_kind,
       f.operator                                        as operator_name,
       f.road                                            as road_ref,
       null::text                                        as direction,
       st_pointonsurface(f.geom::geometry)::geometry(Point, 4326) as location,
       f.sid                                             as acceptance_required,
       f.source_feed                                     as source_ref,
       f.external_id                                     as origin_key,
       f.first_seen_at                                   as recorded_at,
       coalesce(f.updated_at, f.last_seen_at)            as changed_at,
       f.closed_at                                       as withdrawn_at,
       array[f.source_feed]                              as source_refs,
       case when coalesce(f.confidentiality, 'noRestriction') <> 'noRestriction' then 'withhold'
            else coalesce(k.display_class, 'open') end   as display_class,
       coalesce(k.audience, 'public')                    as audience,
       f.confidentiality                                 as confidentiality,
       k.terms_gate                                      as terms_gate,
       k.hold_reason                                     as hold_reason,
       f.kind                                            as stored_kind,
       f.facilities                                      as amenities,
       f.facilities_absent                               as amenities_absent
  from f
  left join lateral (select k.* from public.contract_source_rules k where f.source_feed ~ k.pattern order by k.priority limit 1) k on true
 where f.geom is not null and not coalesce(k.excluded, false);

create or replace view contract.occupancy_observation as
with o as (
  -- p: and odbl: ticks through their facility: the contract id is the
  -- facility's ('p:' || id, indexed by 0313), and the tick a probe of the
  -- tick table's primary key (facility_id, observed_at). Every tick of both
  -- has its facility (odbl by foreign key; p: none unmatched on prod).
  select 'p:' || f.id as facility_id, t.observed_at, t.spaces_free, t.spaces_total, t.status, t.source_feed, t.confidentiality
    from public.parking_facilities f join public.parking_occupancy t on t.facility_id = f.id
  union all
  select 'odbl:' || f.id, t.observed_at, t.spaces_free, t.spaces_total, t.status, t.source_feed, t.confidentiality
    from public.parking_facilities_odbl f join public.parking_occupancy_odbl t on t.facility_id = f.id
  union all
  -- SID ticks are read directly: the SID's static sites may not be loaded
  -- (prod 2026-11-16: no facility row, every tick's facility id unmatched),
  -- and a tick is data the view must carry whether or not its site is known.
  select 'sid:' || t.facility_id, t.observed_at, t.spaces_free, t.spaces_total, t.status, t.source_feed, t.confidentiality
    from public.parking_occupancy_sid t
)
select o.facility_id                                     as facility_id,
       o.observed_at                                     as observed_at,
       o.spaces_free                                     as free_spaces,
       o.spaces_total                                    as total_spaces,
       case
         when o.status is null then 'unknown'
         when o.status ~* 'almost|filling' then 'filling'
         when o.status ~* 'full' then 'full'
         when o.status ~* 'closed' then 'closed'
         when o.status ~* '(free|available|open|vacant)' then 'free'
         when o.status ~* 'unknown' then 'unknown'
         else 'other'
       end                                               as occupancy_status,
       o.source_feed                                     as source_ref,
       case when coalesce(o.confidentiality, 'noRestriction') <> 'noRestriction' then 'withhold'
            else coalesce(k.display_class, 'open') end   as display_class,
       coalesce(k.audience, 'public')                    as audience,
       o.confidentiality                                 as confidentiality,
       k.terms_gate                                      as terms_gate,
       k.hold_reason                                     as hold_reason
  from o
  left join lateral (select k.* from public.contract_source_rules k where o.source_feed ~ k.pattern order by k.priority limit 1) k on true
 where not coalesce(k.excluded, false);

-- --------------------------------------------------------------- transit

-- Static GTFS rows are keyed "<gtfs_feed_key>:<id>"; the feeds row of that
-- key names the source. A stop place is a station (location_type 1) or a
-- stop with no parent; a stop point is every boarding stop (location_type 0),
-- of its parent's place or, with no parent, of its own. A journey is a trip
-- on one service date, "<key>:<trip>:<YYYYMMDD>"; GTFS times count from noon
-- minus 12 h of that date in Europe/Berlin.
create or replace view contract.stop_place as
select s.gtfs_feed_key || ':' || s.id                     as stop_place_id,
       s.name                                             as name,
       s.geom::geometry(Point, 4326)                      as location,
       case when s.id ~ '^[a-z]{2}:[0-9]{5}:' then split_part(s.id, ':', 1) || ':' || split_part(s.id, ':', 2) || ':' || split_part(s.id, ':', 3) end as national_stop_code,
       (select a.ags from public.ags_regions a where a.ags = split_part(s.id, ':', 2)) as region_code,
       coalesce(m.modes, '{}'::text[])                    as modes,
       public.contract_search_fold(s.name)                as search_fold,
       f.source_feed                                      as source_ref,
       s.id                                               as origin_key,
       f.created_at                                       as recorded_at,
       f.updated_at                                       as changed_at,
       null::timestamptz                                  as withdrawn_at,
       array[f.source_feed]                               as source_refs,
       'open'::text                                       as display_class,
       'public'::text                                     as audience,
       d.category                                         as station_category,
       coalesce(d.city,
                (select g.name from public.gazetteer_places g
                  where g.source_id = 'bkg_gvisys' and g.kind = 'city' and g.geom is not null
                  order by g.geom::geometry <-> s.geom::geometry limit 1)) as municipality_name,
       d.eva_no                                           as eva_no,
       coalesce(d.ifopt, case when s.id ~ '^[a-z]{2}:[0-9]{5}:[0-9]+$' then s.id end) as ifopt
  from public.stops s
  join public.feeds f on f.gtfs_feed_key = s.gtfs_feed_key
  left join public.transit_stop_modes m on m.gtfs_feed_key = s.gtfs_feed_key and m.root_id = s.id
  left join lateral (select x.category, x.city, x.eva_no, x.ifopt from public.db_stations x
                      where x.ifopt = s.id and x.closed_at is null
                      order by x.source_id = 'db_stada' desc, x.station_no limit 1) d on true
 where s.deleted_at is null and s.geom is not null and s.name is not null
   and (s.location_type = 1 or (coalesce(s.location_type, 0) = 0 and s.parent_id is null));

create or replace view contract.stop_point as
select s.gtfs_feed_key || ':' || s.id                         as stop_point_id,
       s.gtfs_feed_key || ':' || coalesce(s.parent_id, s.id)  as stop_place_id,
       nullif(btrim(s.platform_code), '')                     as platform_label,
       f.source_feed                                          as source_ref,
       'open'::text                                           as display_class,
       'public'::text                                         as audience,
       nullif(btrim(s.name), '')                              as name
  from public.stops s
  join public.feeds f on f.gtfs_feed_key = s.gtfs_feed_key
 where s.deleted_at is null and coalesce(s.location_type, 0) = 0;

create or replace view contract.transit_line as
select r.gtfs_feed_key || ':' || r.id                                         as line_id,
       coalesce(nullif(btrim(r.short_name), ''), nullif(btrim(r.long_name), ''), r.id) as line_name,
       public.contract_transport_mode(r.route_type)                           as transport_mode,
       f.source_feed                                                          as source_ref,
       'open'::text                                                           as display_class,
       'public'::text                                                         as audience
  from public.routes r
  join public.feeds f on f.gtfs_feed_key = r.gtfs_feed_key
 where r.deleted_at is null;

create or replace view contract.journey as
select t.gtfs_feed_key || ':' || t.id || ':' || to_char(d.service_date, 'YYYYMMDD') as journey_id,
       t.gtfs_feed_key || ':' || t.route_id                                         as line_id,
       d.service_date                                                               as service_date,
       t.headsign                                                                   as destination_label,
       false                                                                        as extra,
       f.source_feed                                                                as source_ref,
       'open'::text                                                                 as display_class,
       'public'::text                                                               as audience
  from public.trips t
  join public.gtfs_service_dates d on d.gtfs_feed_key = t.gtfs_feed_key and d.service_id = t.service_id
  join public.feeds f on f.gtfs_feed_key = t.gtfs_feed_key
 where t.deleted_at is null;

create or replace view contract.scheduled_call as
select t.gtfs_feed_key || ':' || t.id || ':' || to_char(d.service_date, 'YYYYMMDD') as journey_id,
       st.stop_sequence                                                             as call_order,
       st.gtfs_feed_key || ':' || st.stop_id                                        as stop_point_id,
       ((d.service_date + time '12:00') at time zone 'Europe/Berlin') - interval '12 hours' + st.arrival   as planned_arrival_at,
       ((d.service_date + time '12:00') at time zone 'Europe/Berlin') - interval '12 hours' + st.departure as planned_departure_at,
       nullif(btrim(s.platform_code), '')                                           as planned_platform,
       f.source_feed                                                                as source_ref,
       'open'::text                                                                 as display_class,
       'public'::text                                                               as audience
  from public.stop_times st
  join public.trips t on t.gtfs_feed_key = st.gtfs_feed_key and t.id = st.trip_id and t.deleted_at is null
  join public.gtfs_service_dates d on d.gtfs_feed_key = t.gtfs_feed_key and d.service_id = t.service_id
  join public.feeds f on f.gtfs_feed_key = st.gtfs_feed_key
  left join public.stops s on s.gtfs_feed_key = st.gtfs_feed_key and s.id = st.stop_id
 where st.deleted_at is null;

-- DELFI GTFS-RT Trip Updates (CC BY-SA: source_ref delfi_rt_tu, its licence
-- row says share_alike). A tick names a trip of the DELFI static timetable
-- (gtfs_feed_key 1) and carries a delay, not a time: the expected time is the
-- planned call of that trip on the Berlin date of the tick plus the delay.
create or replace view contract.call_observation as
select '1:' || d.trip_id || ':' || to_char((d.observed_at at time zone 'Europe/Berlin')::date, 'YYYYMMDD') as journey_id,
       d.stop_sequence                                                  as call_order,
       d.observed_at                                                    as observed_at,
       c.planned_arrival_at + make_interval(secs => d.delay_s)          as expected_arrival_at,
       c.planned_departure_at + make_interval(secs => d.delay_s)        as expected_departure_at,
       case upper(d.schedule_relationship)
         when 'SCHEDULED' then 'scheduled' when 'SKIPPED' then 'skipped'
         when 'NO_DATA' then 'no_data' when 'UNSCHEDULED' then 'unscheduled'
         else 'other'
       end                                                              as call_status,
       d.source                                                         as source_ref,
       coalesce(k.display_class, 'open')                                as display_class,
       coalesce(k.audience, 'public')                                   as audience
  from public.transit_delays d
  left join contract.scheduled_call c
    on c.journey_id = '1:' || d.trip_id || ':' || to_char((d.observed_at at time zone 'Europe/Berlin')::date, 'YYYYMMDD')
   and c.call_order = d.stop_sequence
  left join lateral (select k.* from public.contract_source_rules k where coalesce(d.source, '') ~ k.pattern order by k.priority limit 1) k on true
 where d.stop_sequence is not null and not coalesce(k.excluded, false);

-- ------------------------------------------------------------- departures

-- One row per scheduled call of the static GTFS, with its line and mode and
-- the live figure of the call, as the platform's departure board composes it
-- (packages/ingest analysis/live-departures.ts, shared by get_departures,
-- get_train_departures and the station page): one figure from ONE feed by
-- precedence, DELFI SIRI ET > DELFI GTFS-RT Trip Updates > the timetable,
-- and every feed that carried the call credited in source_refs.
--
--   * Trip Updates (delfi_rt_tu, through transit_delays_live, the last six
--     hours): a row of the trip observed within 12 h of the planned instant
--     (a stop row carries no service date; a trip row's start_date must be
--     the service date). A CANCELED or DELETED trip row newer than every stop
--     row cancels the call; else the stop's own row, or the newest row of the
--     latest earlier stop (SKIPPED earlier stops passed over): NO_DATA is no
--     figure, SKIPPED on the stop itself cancels it, a delay is the figure,
--     the stop's own absolute time is the figure when within 12 h.
--   * SIRI ET (delfi_siri_et*, delfi_siri_et_calls_latest, the last eight
--     hours, not yet recorded): a call at one of the stop's refs (its DHID,
--     its station's DHID, the DB station's EVA numbers, or an EVA the
--     EVA-DHID bridge pairs with them) of the same line (blanks dropped,
--     upper case) planned in the same minute. A call reached through the
--     bridge must name the same destination; a call that names it wins over
--     one that does not. Its platform, where it carries one, is the live
--     platform: two known and different are a platform change.
--   * Neither figure is read while its feed is down (feed_checks: its last
--     check older than three cadences, a missing cadence read as 600 s),
--     and a delay beyond six hours is no figure (no_forecast).
--
-- Not carried here, the caller's: grouping a station's stops into one board,
-- one row per train when several stops list it, the SIRI ET calls the
-- timetable does not list, and dropping departed rows.
--
-- The ids are built with ::text so that the stop's ids are index
-- expressions (0313): a board is read by stop_place_id or stop_point_id.

create view contract.departure as
select s.gtfs_feed_key::text || ':' || coalesce(s.parent_id, s.id)                    as stop_place_id,
       s.gtfs_feed_key::text || ':' || s.id                                           as stop_point_id,
       t.gtfs_feed_key::text || ':' || t.id || ':' || to_char(d.service_date, 'YYYYMMDD') as journey_id,
       st.stop_sequence                                                               as call_order,
       r.gtfs_feed_key::text || ':' || r.id                                           as line_id,
       coalesce(nullif(btrim(r.short_name), ''), nullif(btrim(r.long_name), ''), r.id) as line_name,
       public.contract_transport_mode(r.route_type)                                   as transport_mode,
       r.route_type                                                                   as route_type,
       nullif(btrim(t.trip_short_name), '')                                           as train_number,
       sc.category                                                                    as train_category,
       coalesce(nullif(btrim(t.headsign), ''), sc.destination)                        as destination_label,
       pl.arr                                                                         as planned_arrival_at,
       pl.dep                                                                         as planned_departure_at,
       nullif(btrim(s.platform_code), '')                                             as planned_platform,
       coalesce(sc.platform, nullif(btrim(s.platform_code), ''))                      as platform,
       coalesce(sc.platform <> btrim(s.platform_code), false)                         as platform_changed,
       st.departure is not null and st.pickup_type <> 1                               as boarding,
       not exists (select 1 from public.stop_times nx
                    where nx.gtfs_feed_key = st.gtfs_feed_key and nx.trip_id = st.trip_id
                      and nx.stop_sequence > st.stop_sequence and nx.deleted_at is null) as terminates,
       fig.feed is not null                                                           as realtime,
       fig.feed                                                                       as realtime_source,
       coalesce(fig.cancelled, false)                                                 as cancelled,
       fig.delay_s                                                                    as delay_s,
       round(fig.delay_s / 60.0)::integer                                             as delay_min,
       pl.arr + make_interval(secs => fig.delay_s)                                    as expected_arrival_at,
       pl.dep + make_interval(secs => fig.delay_s)                                    as expected_departure_at,
       fig.refused or (fig.feed is null and sc.call_at is not null)                   as no_forecast,
       fig.observed_at                                                                as observed_at,
       src.feed                                                                       as source_ref,
       array_remove(array[src.feed,
                          case when tu.carried then 'delfi_rt_tu' end,
                          case when sc.call_at is not null then sc.source_feed end], null) as source_refs,
       coalesce(k.display_class, 'open')                                              as display_class,
       coalesce(k.audience, 'public')                                                 as audience
  from public.stops s
  join public.stop_times st on st.gtfs_feed_key = s.gtfs_feed_key and st.stop_id = s.id and st.deleted_at is null
  join public.trips t on t.gtfs_feed_key = st.gtfs_feed_key and t.id = st.trip_id and t.deleted_at is null
  join public.routes r on r.gtfs_feed_key = t.gtfs_feed_key and r.id = t.route_id and r.deleted_at is null
  join public.gtfs_service_dates d on d.gtfs_feed_key = t.gtfs_feed_key and d.service_id = t.service_id
  -- the timetable's feed, read per row: joined, its key would let the planner pair
  -- service dates and routes with the stop times by the feed key alone
  cross join lateral (select (select f.source_feed from public.feeds f where f.gtfs_feed_key = s.gtfs_feed_key) as feed offset 0) src
  cross join lateral (
    select ((d.service_date + time '12:00') at time zone 'Europe/Berlin') - interval '12 hours' + st.arrival   as arr,
           ((d.service_date + time '12:00') at time zone 'Europe/Berlin') - interval '12 hours' + st.departure as dep
  ) pl
  -- DELFI GTFS-RT Trip Updates: the DELFI timetable's trips only, while the feed is up
  left join lateral (
    with run as (
      select u.stop_sequence, u.delay_s, upper(u.schedule_relationship) as rel, u.event_at, u.observed_at
        from public.transit_delays_live u
       where s.gtfs_feed_key = 1 and u.trip_id = t.id
         and abs(extract(epoch from u.observed_at - coalesce(pl.dep, pl.arr))) <= 43200
         and (u.stop_sequence is not null or u.start_date is null or u.start_date = to_char(d.service_date, 'YYYYMMDD'))
         and exists (select 1 from public.feed_checks c
                      where c.feed_key = 'tripupdates' and c.checked_at is not null
                        and (c.paused or c.checked_at >= now() - 3 * make_interval(secs => coalesce(nullif(c.cadence_s, 0), 600))))
    ),
    trip_row as (select x.rel, x.observed_at from run x where x.stop_sequence is null order by x.observed_at desc limit 1),
    stop_row as (
      select x.stop_sequence, x.delay_s, x.rel, x.event_at, x.observed_at from run x
       where x.stop_sequence <= st.stop_sequence and not (x.rel = 'SKIPPED' and x.stop_sequence <> st.stop_sequence)
       order by x.stop_sequence desc limit 1
    )
    select exists (select 1 from run) as carried,
           case
             when tr.rel in ('CANCELED', 'CANCELLED', 'DELETED')
                  and tr.observed_at >= coalesce((select max(x.observed_at) from run x where x.stop_sequence is not null), '-infinity') then true
             when sr.rel = 'SKIPPED' then true
           end as cancelled,
           case
             when tr.rel in ('CANCELED', 'CANCELLED', 'DELETED')
                  and tr.observed_at >= coalesce((select max(x.observed_at) from run x where x.stop_sequence is not null), '-infinity') then null
             when sr.rel in ('NO_DATA', 'SKIPPED') then null
             when sr.delay_s is not null then sr.delay_s
             when sr.stop_sequence = st.stop_sequence and sr.event_at is not null
                  and abs(extract(epoch from sr.event_at - coalesce(pl.dep, pl.arr))) <= 43200
               then round(extract(epoch from sr.event_at - coalesce(pl.dep, pl.arr)))::integer
           end as delay_s,
           coalesce(case when tr.rel in ('CANCELED', 'CANCELLED', 'DELETED') then tr.observed_at end, sr.observed_at) as observed_at
      from (select 1) one
      left join trip_row tr on true
      left join stop_row sr on true
  ) tu on true
  -- DELFI SIRI ET: the call of this stop, line and planned minute, while its feed is up
  left join lateral (
    select c.platform, c.category, c.destination, c.source_feed, c.aimed_dep as call_at, c.observed_at,
           case when c.cancelled or c.journey_cancelled then null
                else coalesce(c.delay_s, round(extract(epoch from c.expected_dep - c.aimed_dep))::integer) end as delay_s,
           c.cancelled or c.journey_cancelled as cancelled
      from (select s.id as ref, false as bridged
            union select coalesce(s.parent_id, s.id), false
            union select e.eva, false
                    from public.db_stations x, unnest(x.eva_nos) e(eva)
                   where x.ifopt = coalesce(s.parent_id, substring(s.id from '^[a-z]{2}:[0-9]{5}:[0-9]+'), s.id) and x.closed_at is null
            union select p.eva, true
                    from public.delfi_siri_et_stop_pairs p
                   where p.dhid = s.id or p.station_dhid = coalesce(s.parent_id, substring(s.id from '^[a-z]{2}:[0-9]{5}:[0-9]+'), s.id)) refs
      join public.delfi_siri_et_calls_latest c
        on c.stop_ref = refs.ref
       and coalesce(c.expected_dep, c.aimed_dep) >= pl.dep - interval '1 hour'
       and coalesce(c.expected_dep, c.aimed_dep) <= pl.dep + interval '6 hours 1 minute'
       and c.aimed_dep > pl.dep - interval '1 minute' and c.aimed_dep < pl.dep + interval '1 minute'
     where s.gtfs_feed_key = 1 and pl.dep is not null
       and not c.recorded
       and c.observed_at > now() - interval '8 hours' and c.observed_at <= now()
       and upper(regexp_replace(c.line, '\s+', '', 'g')) = upper(regexp_replace(coalesce(nullif(btrim(r.short_name), ''), nullif(btrim(r.long_name), ''), ''), '\s+', '', 'g'))
       and (not refs.bridged or c.destination = btrim(t.headsign))
       and exists (select 1 from public.feed_checks k
                    where k.feed_key = c.source_feed and k.checked_at is not null
                      and (k.paused or k.checked_at >= now() - 3 * make_interval(secs => coalesce(nullif(k.cadence_s, 0), 600))))
     order by (c.destination = btrim(t.headsign)) desc nulls last, refs.bridged, c.observed_at desc
     limit 1
  ) sc on true
  cross join lateral (
    select case when sc.call_at is not null and (sc.cancelled or abs(coalesce(sc.delay_s, 0)) <= 21600)
                     and (sc.cancelled or sc.delay_s is not null) then 'siri'
                when tu.carried and (tu.cancelled or (tu.delay_s is not null and abs(tu.delay_s) <= 21600)) then 'tu'
           end as pick,
           (sc.delay_s is not null and abs(sc.delay_s) > 21600) or (tu.delay_s is not null and abs(tu.delay_s) > 21600) as over
  ) pk
  cross join lateral (
    select case pk.pick when 'siri' then sc.source_feed when 'tu' then 'delfi_rt_tu' end as feed,
           case pk.pick when 'siri' then sc.cancelled when 'tu' then coalesce(tu.cancelled, false) end as cancelled,
           case pk.pick when 'siri' then sc.delay_s when 'tu' then tu.delay_s end as delay_s,
           case pk.pick when 'siri' then sc.observed_at when 'tu' then tu.observed_at end as observed_at,
           pk.pick is null and pk.over as refused
  ) fig
  -- the envelope of the feed whose figure is shown (the timetable's rows are open and public)
  left join lateral (select k.display_class, k.audience from public.contract_source_rules k
                      where fig.feed is not null and fig.feed ~ k.pattern order by k.priority limit 1) k on true
 where s.deleted_at is null;
grant select on contract.departure to api_reader;

-- ------------------------------------------------------------- stations

create or replace view contract.station_facility as
select 'equipment:' || e.equipment_id                               as facility_id,
       public.contract_stop_place_of(e.stop_place_id)               as stop_place_id,
       e.kind                                                       as facility_kind,
       e.description                                                as position_text,
       coalesce(st.state, 'unknown')                                as facility_status,
       coalesce(st.status_since, st.last_seen_at, e.last_seen_at)   as status_observed_at,
       coalesce(st.source_feed, e.source_feed)                      as source_ref,
       'open'::text                                                 as display_class,
       'public'::text                                               as audience
  from public.station_equipment e
  left join public.station_equipment_state st on st.equipment_id = e.equipment_id
 where e.closed_at is null
union all
select 'fasta:' || f.equipment_no,
       (select public.contract_stop_place_of(d.ifopt) from public.db_stations d where d.station_no = f.station_no),
       f.kind,
       f.description,
       f.state,
       coalesce(f.state_since, f.last_seen_at),
       f.source_feed,
       'open',
       'public'
  from public.db_facilities f;

-- --------------------------------------------------------------- weather

-- DWD warnings, one row per warning and warn cell. A warn cell is 1 + the
-- five-digit Kreis + 000, or 8 + the eight-digit municipality key: either
-- way digits 2-6 are the Kreis, which is the region when we hold it.
create or replace view contract.weather_warning as
select 'dwd:' || w.id                                                 as warning_id,
       case
         when w.event ~* 'gewitter' then 'thunderstorm'
         when w.event ~* '(sturm|wind|böen|orkan)' then 'wind'
         when w.event ~* 'hochwasser|flut' then 'flood'
         when w.event ~* 'schnee' then 'snow'
         when w.event ~* '(glätte|glatteis|eis)' then 'ice'
         when w.event ~* 'regen' then 'rain'
         when w.event ~* 'nebel' then 'fog'
         when w.event ~* 'hitze' then 'heat'
         when w.event ~* 'frost' then 'frost'
         when w.event ~* 'uv' then 'uv'
         else 'other'
       end                                                            as hazard,
       w.level::integer                                               as warning_level,
       coalesce(w.severity, w.level::text)                            as level_label,
       case when w.closed_reason = 'withdrawn' then 'cancelled' else 'actual' end as message_status,
       'Deutscher Wetterdienst'::text                                 as issuer_name,
       coalesce(w.headline, w.event)                                  as headline,
       'de'::text                                                     as text_lang,
       w.valid_from                                                   as valid_from,
       w.valid_to                                                     as valid_to,
       w.published_at                                                 as published_at,
       (select a.ags from public.ags_regions a where a.ags = substr(w.warncell_id, 2, 5)) as region_code,
       w.source_feed                                                  as source_ref,
       w.first_seen_at                                                as recorded_at,
       w.closed_at                                                    as withdrawn_at,
       'open'::text                                                   as display_class,
       'public'::text                                                 as audience
  from public.weather_warnings w
 where w.deleted_at is null and w.valid_from is not null;

-- ------------------------------------------------------------------ terms

-- The terms a row's terms_gate names: id, version, the day in force, the
-- text per language (German binding) and the provider's own terms. The API
-- returns the text with a gated answer and serves the row only to a request
-- that accepted this version; nothing is stored with a key.
create view contract.terms as
select t.terms_gate                as terms_gate,
       t.terms_id                  as terms_id,
       t.terms_version             as terms_version,
       t.effective_on              as effective_on,
       x.lang                      as lang,
       x.binding                   as binding,
       x.heading                   as heading,
       x.body                      as body,
       x.terms_url                 as terms_url,
       t.provider_terms_url        as provider_terms_url,
       t.source_id                 as source_ref,
       'open'::text                as display_class,
       'public'::text              as audience
  from public.source_terms t
  join public.source_terms_texts x on x.terms_gate = t.terms_gate;
grant select on contract.terms to api_reader;

-- ------------------------------------------------------------------ rules

create or replace view contract.rule_topic as
select t.topic_code                         as topic_code,
       t.title_de                           as title,
       t.reviewed_on                        as reviewed_on,
       t.title_en                           as title_en,
       'viafrei_rules'::text                as source_ref,
       array['viafrei_rules']::text[]       as source_refs,
       'open'::text                         as display_class,
       'public'::text                       as audience
  from public.driving_rule_topics t;

create or replace view contract.rule_statement as
select f.fact_key                           as statement_id,
       f.topic_code                         as topic_code,
       f.position                           as position,
       f.body_de                            as body,
       f.source_name                        as legal_basis,
       f.body_en                            as body_en,
       f.source_url                         as legal_basis_url,
       f.source_note_de                     as legal_basis_note,
       f.source_note_en                     as legal_basis_note_en,
       f.to_verify_de                       as to_verify,
       f.to_verify_en                       as to_verify_en,
       f.reviewed_on                        as reviewed_on,
       f.headline                           as headline,
       'viafrei_rules'::text                as source_ref,
       array['viafrei_rules']::text[]       as source_refs,
       'open'::text                         as display_class,
       'public'::text                       as audience
  from public.driving_rule_facts f;

-- --------------------------------------------------------------- coverage

create or replace view contract.message_coverage as
select m.state_code                         as state_code,
       m.source_ref                         as source_ref,
       m.coverage_role                      as coverage_role,
       m.current_only                       as current_only,
       m.measured_on                        as measured_on,
       'open'::text                         as display_class,
       'public'::text                       as audience
  from public.message_coverage_sources m;

-- ------------------------------------------------------------ hydrogen

-- The hydrogen stations we did not close, as find_hydrogen_station reads
-- them (hydrogen_stations_live): address, refill and opening as the
-- publisher states them.
create view contract.hydrogen_station as
select h.source_feed || ':' || h.id                      as station_id,
       h.name                                            as name,
       h.operator                                        as operator_name,
       h.brand                                           as brand,
       h.geom::geometry(Point, 4326)                     as location,
       h.address                                         as address,
       h.refill                                          as refill,
       h.opening                                         as opening,
       h.provider_updated_at                             as provider_updated_at,
       h.last_seen_at                                    as last_seen_at,
       h.source_feed                                     as source_ref,
       h.first_seen_at                                   as recorded_at,
       h.closed_at                                       as withdrawn_at,
       coalesce(k.display_class, 'open')                 as display_class,
       coalesce(k.audience, 'public')                    as audience
  from public.hydrogen_stations h
  left join lateral (select k.* from public.contract_source_rules k where h.source_feed ~ k.pattern order by k.priority limit 1) k on true
 where h.closed_at is null and h.geom is not null and not coalesce(k.excluded, false);
grant select on contract.hydrogen_station to api_reader;

-- ---------------------------------------------------------- speed cameras

-- Every speed camera find_speed_cameras reads: the OpenStreetMap cameras,
-- the official enforcement points and the Hamburg police cameras, one row
-- each; the id's prefix keeps the families apart. kind: fixed for an OSM or
-- Hamburg camera, the publisher's word for an official one. admin_code: the
-- official row's AGS, else NULL (the platform derives an OSM camera's cell
-- from the nearest municipality at read time).
create view contract.speed_camera as
with c as (
  select 'osm:' || o.osm_type || o.osm_id as camera_id, 'fixed'::text as kind, o.enforces, o.geom, o.max_speed_kmh,
         null::smallint as max_speed_hgv_kmh, o.direction, o.name, null::text as street, null::text as location_text,
         null::text as admin_code, o.land, o.extract_date as data_as_of, null::date as valid_from, null::date as valid_to,
         o.source_id as source_ref, o.first_seen_at, o.last_seen_at
    from public.osm_speed_cameras o where o.closed_at is null
  union all
  select 'se:' || s.id, s.kind, s.enforces, s.geom, s.max_speed_kmh, s.max_speed_hgv_kmh, s.direction, s.municipality,
         s.street, s.location_text, s.ags, null, s.data_as_of, s.valid_from, s.valid_to,
         s.source_feed, s.first_seen_at, s.last_seen_at
    from public.speed_enforcement s where s.closed_at is null
  union all
  select 'hh:' || h.camera_id, 'fixed', null, h.geom::geography, null, null, null, h.location_label, null, h.note,
         '02000000', 'hamburg', null, null, null, h.source_feed, h.first_seen_at, h.last_seen_at
    from public.hh_cameras h where h.closed_at is null
)
select c.camera_id                                       as camera_id,
       c.kind                                            as camera_kind,
       c.enforces                                        as enforces,
       c.geom::geometry(Point, 4326)                     as location,
       c.max_speed_kmh::integer                          as max_speed_kmh,
       c.max_speed_hgv_kmh::integer                      as max_speed_hgv_kmh,
       c.direction                                       as direction,
       c.name                                            as name,
       c.street                                          as street,
       c.location_text                                   as location_text,
       c.admin_code                                      as admin_code,
       c.land                                            as land_name,
       c.data_as_of                                      as data_as_of,
       c.valid_from                                      as valid_from,
       c.valid_to                                        as valid_to,
       c.source_ref                                      as source_ref,
       c.first_seen_at                                   as recorded_at,
       c.last_seen_at                                    as last_seen_at,
       coalesce(k.display_class, 'open')                 as display_class,
       coalesce(k.audience, 'public')                    as audience,
       k.origin_restriction                              as origin_restriction
  from c
  left join lateral (select k.* from public.contract_source_rules k where c.source_ref ~ k.pattern order by k.priority limit 1) k on true
 where not coalesce(k.excluded, false);
grant select on contract.speed_camera to api_reader;

-- --------------------------------------------------------------- sharing

-- The bike-sharing stations, their status ticks and the free-floating
-- vehicles of the systems we admitted (gbfs_*_live), as find_sharing reads
-- them.
create view contract.sharing_station as
select s.system_id || ':' || s.station_id                as station_id,
       s.system_id                                       as system_id,
       y.name                                            as system_name,
       s.name                                            as name,
       s.capacity                                        as capacity,
       s.is_virtual                                      as is_virtual,
       s.geom::geometry(Point, 4326)                     as location,
       y.status_seen_at                                  as status_seen_at,
       s.source_feed                                     as source_ref,
       s.first_seen_at                                   as recorded_at,
       coalesce(k.display_class, 'open')                 as display_class,
       coalesce(k.audience, 'public')                    as audience
  from public.gbfs_stations s
  join public.gbfs_systems y using (system_id)
  left join lateral (select k.* from public.contract_source_rules k where s.source_feed ~ k.pattern order by k.priority limit 1) k on true
 where s.closed_at is null and y.admitted and s.geom is not null and not coalesce(k.excluded, false);
grant select on contract.sharing_station to api_reader;

create view contract.sharing_station_status as
select t.system_id || ':' || t.station_id                as station_id,
       t.observed_at                                     as observed_at,
       t.vehicles_available                              as vehicles_available,
       t.electric_available                              as electric_available,
       t.docks_available                                 as docks_available,
       t.is_renting                                      as is_renting,
       t.is_returning                                    as is_returning,
       t.reported_at                                     as reported_at,
       y.source_feed                                     as source_ref,
       coalesce(k.display_class, 'open')                 as display_class,
       coalesce(k.audience, 'public')                    as audience
  from public.gbfs_station_status t
  join public.gbfs_systems y using (system_id)
  left join lateral (select k.* from public.contract_source_rules k where y.source_feed ~ k.pattern order by k.priority limit 1) k on true
 where y.admitted and not coalesce(k.excluded, false);
grant select on contract.sharing_station_status to api_reader;

create view contract.sharing_vehicle as
select v.system_id || ':' || v.seq                       as vehicle_id,
       v.system_id                                       as system_id,
       y.name                                            as system_name,
       v.form_factor                                     as form_factor,
       v.propulsion                                      as propulsion,
       v.range_m                                         as range_m,
       v.geom::geometry(Point, 4326)                     as location,
       v.observed_at                                     as observed_at,
       y.vehicles_seen_at                                as vehicles_seen_at,
       v.source_feed                                     as source_ref,
       coalesce(k.display_class, 'open')                 as display_class,
       coalesce(k.audience, 'public')                    as audience
  from public.gbfs_vehicles v
  join public.gbfs_systems y using (system_id)
  left join lateral (select k.* from public.contract_source_rules k where v.source_feed ~ k.pattern order by k.priority limit 1) k on true
 where y.admitted and v.geom is not null and not coalesce(k.excluded, false);
grant select on contract.sharing_vehicle to api_reader;

-- ------------------------------------------------------- POIs, addresses

-- The OpenStreetMap points of interest and addresses we did not close, as
-- find_poi, find_nearby, find_address and describe_location read them. The
-- folds are the platform's own normalised names (name_norm, street_norm,
-- house_number_norm, place_norm).
create view contract.poi as
select 'osm:' || p.osm_type || p.osm_id                  as poi_id,
       p.name                                            as name,
       p.name_norm                                       as name_fold,
       p.category                                        as category,
       p.category_value                                  as category_value,
       p.brand                                           as brand,
       p.operator                                        as operator_name,
       p.street                                          as street,
       p.house_number                                    as house_number,
       p.postcode                                        as postcode,
       p.place                                           as place_name,
       p.place_norm                                      as place_fold,
       p.land                                            as land_name,
       p.access                                          as access,
       p.geom::geometry(Point, 4326)                     as location,
       p.extract_date                                    as data_as_of,
       p.source_id                                       as source_ref,
       p.first_seen_at                                   as recorded_at,
       coalesce(k.display_class, 'open')                 as display_class,
       coalesce(k.audience, 'public')                    as audience
  from public.osm_pois p
  left join lateral (select k.* from public.contract_source_rules k where p.source_id ~ k.pattern order by k.priority limit 1) k on true
 where p.closed_at is null and p.geom is not null and not coalesce(k.excluded, false);
grant select on contract.poi to api_reader;

create view contract.address as
select 'osm:' || a.osm_type || a.osm_id                  as address_id,
       a.street                                          as street,
       a.street_norm                                     as street_fold,
       a.house_number                                    as house_number,
       a.house_number_norm                               as house_number_fold,
       a.postcode                                        as postcode,
       a.place                                           as place_name,
       a.place_norm                                      as place_fold,
       a.land                                            as land_name,
       a.geom::geometry(Point, 4326)                     as location,
       a.extract_date                                    as data_as_of,
       a.source_id                                       as source_ref,
       a.first_seen_at                                   as recorded_at,
       coalesce(k.display_class, 'open')                 as display_class,
       coalesce(k.audience, 'public')                    as audience
  from public.osm_addresses a
  left join lateral (select k.* from public.contract_source_rules k where a.source_id ~ k.pattern order by k.priority limit 1) k on true
 where a.closed_at is null and a.geom is not null and not coalesce(k.excluded, false);
grant select on contract.address to api_reader;

-- ------------------------------------------------------ transit service

-- The DELFI service alerts we did not close, as check_transit_disruption
-- reads them; a restricted alert is withheld, as the platform never shows it.
create view contract.service_alert as
select a.source_feed || ':' || a.alert_id                as alert_id,
       a.header                                          as header,
       a.description                                     as description,
       a.cause                                           as cause,
       a.effect                                          as effect,
       a.url                                             as url,
       a.active_from                                     as active_from,
       a.active_to                                       as active_to,
       a.active_periods                                  as active_periods,
       a.route_ids                                       as route_ids,
       a.line_names                                      as line_names,
       a.stop_ids                                        as stop_ids,
       a.kreise                                          as district_codes,
       a.lands                                           as state_codes,
       a.placed_by                                       as placed_by,
       a.dedupe_key                                      as dedupe_key,
       a.source_feed                                     as source_ref,
       a.first_seen_at                                   as recorded_at,
       coalesce(a.provider_updated_at, a.last_seen_at)   as changed_at,
       case when coalesce(a.confidentiality, 'noRestriction') <> 'noRestriction' then 'withhold'
            else coalesce(k.display_class, 'open') end   as display_class,
       coalesce(k.audience, 'public')                    as audience,
       a.confidentiality                                 as confidentiality
  from public.delfi_service_alerts a
  left join lateral (select k.* from public.contract_source_rules k where a.source_feed ~ k.pattern order by k.priority limit 1) k on true
 where a.closed_at is null and not coalesce(k.excluded, false);
grant select on contract.service_alert to api_reader;

-- The region-wide punctuality of the last half hour of Trip Updates, per
-- Land, Kreis and Germany, as transit_punctuality_area_live computes it at
-- read time; its licence permits region-wide totals only.
create view contract.transit_punctuality as
select p.level                                           as area_level,
       p.area                                            as area_code,
       p.name                                            as area_name,
       p.trips_observed                                  as trips_observed,
       p.trips_late                                      as trips_late,
       p.trips_skipped_stop                              as trips_skipped_stop,
       p.trips_untimed                                   as trips_untimed,
       p.median_worst_delay_s                            as median_worst_delay_s,
       p.stops_seen                                      as stops_seen,
       p.newest                                          as observed_at,
       'delfi_rt_tu'::text                               as source_ref,
       coalesce(k.display_class, 'open')                 as display_class,
       coalesce(k.audience, 'public')                    as audience
  from public.transit_punctuality_area_live p
  left join lateral (select k.* from public.contract_source_rules k where 'delfi_rt_tu' ~ k.pattern order by k.priority limit 1) k on true
 where p.trips_observed + p.trips_untimed + p.trips_skipped_stop > 0 and not coalesce(k.excluded, false);
grant select on contract.transit_punctuality to api_reader;

-- ----------------------------------------------------------- street bays

-- The on-street bays (disabled-badge and charging bays) we did not close,
-- with their newest state, as find_parking {kind: disabled_badge} reads them.
create view contract.street_bay as
select b.bay_id                                          as bay_id,
       b.kind                                            as bay_kind,
       b.publisher_kind                                  as publisher_kind,
       b.street                                          as street,
       b.house_number                                    as house_number,
       b.postcode                                        as postcode,
       b.city                                            as city,
       b.charge_point_operator                           as charge_point_operator,
       b.spaces                                          as spaces,
       b.reserved_when                                   as reserved_when,
       b.geom::geometry(Point, 4326)                     as location,
       t.state                                           as state,
       t.message_at                                      as state_at,
       b.last_message_at                                 as last_message_at,
       b.source_feed                                     as source_ref,
       b.first_seen_at                                   as recorded_at,
       coalesce(k.display_class, 'open')                 as display_class,
       coalesce(k.audience, 'public')                    as audience
  from public.street_bays b
  left join public.street_bay_state t on t.bay_id = b.bay_id
  left join lateral (select k.* from public.contract_source_rules k where b.source_feed ~ k.pattern order by k.priority limit 1) k on true
 where b.closed_at is null and b.geom is not null and not coalesce(k.excluded, false);
grant select on contract.street_bay to api_reader;

-- ------------------------------------------------------------- comments

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('hydrogen_station', 'public.hydrogen_stations we did not close (hydrogen_stations_live); address, refill and opening as published (JSON).'),
    ('speed_camera', 'OpenStreetMap cameras (osm:), official enforcement points (se:) and Hamburg police cameras (hh:) we did not close. admin_code: the official AGS; NULL for an OSM camera.'),
    ('sharing_station', 'public.gbfs_stations of an admitted system that we did not close.'),
    ('sharing_station_status', 'Every public.gbfs_station_status tick of an admitted system.'),
    ('sharing_vehicle', 'public.gbfs_vehicles of an admitted system.'),
    ('poi', 'public.osm_pois we did not close; name_fold and place_fold are the platform''s normalised names.'),
    ('address', 'public.osm_addresses we did not close; the folds are the platform''s normalised street, house number and place.'),
    ('service_alert', 'public.delfi_service_alerts we did not close; a restricted alert is withheld.'),
    ('transit_punctuality', 'public.transit_punctuality_area_live: the last half hour of Trip Updates per Land, Kreis, city and Germany, computed at read time, an area with no trip seen left out; region-wide totals only.'),
    ('street_bay', 'public.street_bays we did not close, with the newest public.street_bay_state.'),
    ('publisher', 'One row per source of contract.source (public.contract_sources): publisher_id is the source key, display_name the feed title, or for a register-only source its attribution line. website: the page the register names for the source, else the catalogue''s offer page.'),
    ('licence', 'One row per licence label of a published contract source. licence_url: public.licence_texts (0309), else the canonical URL of a CC, ODbL, Datenlizenz Deutschland or GeoNutzV label, else the one source page that carries the label, else the register''s source page; category, share_alike and attribution_required are read off the label.'),
    ('source', 'One row per source of public.contract_sources (feeds, ingestor sources, the register''s static sources), with the envelope of public.contract_source_rules and the domain of public.contract_source_domains. Attribution, changes_statement, use_classes (empty = no use permitted: an unregistered source), review_signed_on and register_version from public.source_register (0309). stale_after_s is 3 x cadence (the catalogue''s, else control.data_status); a source with no cadence is never stale (owner decision 2026-11-16): freshness_target_s and stale_after_s are NULL and the caller shows its as-of time alone. share_alike_offer_url: the Impressum, where the share-alike offer is redeemed, on a share-alike source. A source whose licence was never read is not published.'),
    ('source_freshness', 'control.data_status per ledger key: data_as_of = last change seen, confirmed_at = last success, updates_paused = the gate''s pause.'),
    ('admin_region', 'public.ags_regions (Land, Kreis). boundary: no source (ags_regions holds a point).'),
    ('place', 'public.gazetteer_places with a location (OSM is excluded by that table''s own constraint). published_at: no source.'),
    ('place_alias', 'The name and the English name of each place; search_fold is contract_search_fold() of the label.'),
    ('road', 'public.autobahn_roads (Autobahn GmbH API). geometry: the BASt LCL chains of public.contract_road_line(), as the platform''s motorway map draws them; source_refs credits bast_lcl when it is there. length_km and states: no source.'),
    ('junction', 'BASt TMC junction points (public.tmc_locations, class P1) of the A-roads, source bast_lcl. state_code: derived, the Land of the nearest BKG municipality point (bkg_gvisys). chainage_km: no source.'),
    ('traffic_event', 'The current Autobahn GmbH events (newest sweep per road and kind) and the DATEX II road events we did not retract, with the publisher''s confidentiality. lanes, length and direction: no source; is_blocked, traffic_type, delay_s only on Autobahn rows.'),
    ('traffic_event_observation', 'Every Autobahn tick and every DATEX II tick of an event we did not retract. version_no: Autobahn ticks have none (NULL).'),
    ('fuel_station', 'public.fuel_stations we did not retract. open_state_at: no source.'),
    ('fuel_product', 'public.fuel_products.'),
    ('fuel_price_observation', 'Every public.fuel_prices tick of a permitted source.'),
    ('charging_site', 'public.charging_sites with a location that we did not retract. operator_is_person: no source.'),
    ('charge_point', 'public.charging_points of a site that we did not retract. point_id is the EVSE id, which the status ticks carry (else feed:point key); the same EVSE listed by two feeds is two rows with one point_id. connectors: the plugs of connector_types in the tool vocabulary (ccs2, type2, chademo, mcs); the price and register columns are the terms find_charging_station filters by (open247, card, free, public).'),
    ('charge_point_state_observation', 'Every public.charging_point_status tick; point_id is the EVSE id, as charge_point''s.'),
    ('parking_facility', 'The four parking families (p:, bysa:, odbl:, sid:) we did not retract; SID facilities carry terms_gate sid-terms-1 (a per-request acceptance, contract.terms). direction: no source.'),
    ('occupancy_observation', 'Every tick of parking_occupancy, _odbl and _sid, keyed like parking_facility; SID ticks carry terms_gate sid-terms-1 whether or not their site is loaded.'),
    ('terms', 'The terms a gated row''s terms_gate names (public.source_terms, 0309): ViaFrei''s terms of use, section 2, per language, verbatim from the site; the German text binds.'),
    ('stop_place', 'Stations and parentless stops of the static GTFS; modes from transit_stop_modes; search_fold is contract_search_fold(name). station_category, eva_no: the DB station (db_stations, StaDa first) whose IFOPT is the stop''s id, else NULL. municipality_name: that station''s city, else the nearest BKG municipality point. ifopt: the DB station''s, else the stop''s own DHID. withdrawn_at: no source.'),
    ('stop_point', 'Every boarding stop of the static GTFS; name is the stop''s own, which a departure board shows for a trip with no headsign (its last stop''s).'),
    ('transit_line', 'public.routes; transport_mode as transit_stop_modes types it.'),
    ('journey', 'A trip on each of its service dates. extra: the static timetable has no extra trips (false).'),
    ('scheduled_call', 'public.stop_times on each service date of its trip, in absolute time.'),
    ('departure', 'One row per scheduled call of the static GTFS with its line, mode and the live figure by the platform''s precedence (SIRI ET > GTFS-RT Trip Updates > timetable), the realtime platform and platform change, cancellation, delay in seconds and minutes; source_refs credits every feed that carried the call. The caller groups a station''s stops, keeps one row per train and drops departed rows.'),
    ('call_observation', 'DELFI GTFS-RT stop-time ticks (CC BY-SA), expected = planned + delay on the tick''s Berlin date.'),
    ('station_facility', 'Lifts and escalators of DB OpenStation and KVB with their state, and DB FaSta. stop_place_id: the DELFI stop of the equipment''s DHID (contract_stop_place_of), FaSta''s through its DB station''s IFOPT; NULL when the timetable holds no such stop.'),
    ('weather_warning', 'DWD warnings per warn cell (German text). English warnings: no level, not mapped.'),
    ('source_note', 'The condition and purpose notes of public.source_register_notes (0309), per source that names the register row. The MTS-K purpose note is German only and is published verbatim under lang de and en.'),
    ('rule_topic', 'public.driving_rule_topics (0310): title in German, title_en appended.'),
    ('rule_statement', 'public.driving_rule_facts (0310): body in German, legal_basis the official source''s name; appended the English text, the source URL and note, the to-verify note, the review date and the headline flag.'),
    ('message_coverage', 'public.message_coverage_sources (0311): per Land its own message feeds and the measured NMS relay; measured_on appended.')
  ) AS t(v, c) LOOP
    EXECUTE format('COMMENT ON VIEW contract.%I IS %L', r.v, 'Contract 0.3. ' || r.c);
  END LOOP;
END $$;

comment on schema contract is 'The read contract of viafrei-api, version 0.3: views over the platform''s tables (0312), each row with its licence envelope, read by the role api_reader alone. contract_info states the version.';
