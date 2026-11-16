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
--                       and MCP keys only (Tankerkoenig fuel, Autobahn GmbH
--                       API, Polizei Hamburg and BW Landesmeldestelle
--                       messages, Toll Collect SID);
--   confidentiality     the publisher's marking, raw, where the table has it;
--   terms_gate          the terms a key must have accepted (sid-terms-1);
--   hold_reason         set when no key may read the row yet: Toll Collect
--                       SID until the API's terms exist (no_api_terms);
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
-- function that reads a table (it would run with the caller's rights): the
-- Autobahn payload is resolved inline, as autobahn_raw_resolve() does.
--
-- rollback: re-run the create view statements of 0307 as create or replace
-- view after dropping the appended columns, i.e. drop and recreate each
-- replaced view from 0307 (then grant select on all tables in schema
-- contract to api_reader), then drop view public.contract_sources,
-- public.contract_source_domains, public.contract_source_rules;
--   delete from schema_migrations where version = 312;

-- create or replace view takes an ACCESS EXCLUSIVE lock on the view.
set local lock_timeout = '5s';

-- ------------------------------------------------------------ the rules

create view public.contract_source_rules as
select t.priority, t.pattern, t.excluded, t.audience, t.display_class, t.terms_gate, t.hold_reason, t.origin_restriction
  from (values
    (10, '(tankerkoenig_hist|truckpark_occ|(^|_)ris_|park_by_lkw_dyn|enerando_stat)', true, null, null, null, null, null),
    (20, '(truckpark_sid|toll_collect_sid)', false, 'own', 'gated', 'sid-terms-1', 'no_api_terms', null),
    (30, 'tankerkoenig', false, 'own', 'no_redistribution', null, null, null),
    (40, '(^|_)traffic_bw$', false, 'own', 'consumer_only', null, null, 'bw_rvwd'),
    (50, '(traffic_hamburg|polizei_hamburg)', false, 'own', 'consumer_only', null, null, 'polizei_hamburg'),
    (60, '^autobahn$', false, 'own', 'consumer_only', null, null, null),
    (70, '(eliso|(^|_)elu_|chargepool|park_sh_truck|trucklounge|christophorus|bosch)', false, 'public', 'consumer_only', null, null, null)
  ) as t(priority, pattern, excluded, audience, display_class, terms_gate, hold_reason, origin_restriction);
comment on view public.contract_source_rules is 'The licence envelope of the contract views (0312), per source key: the first rule by priority whose pattern matches the key applies; no match = public, open. excluded = no row of the source is mapped. From the data steward''s rulings of 2026-11-16; a change is a migration.';

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

create or replace view contract.publisher as
select s.source_ref                    as publisher_id,
       s.publisher_name                as display_name,
       null::text                      as website
  from public.contract_sources s
  left join lateral (select k.excluded from public.contract_source_rules k where s.source_ref ~ k.pattern order by k.priority limit 1) k on true
 where not coalesce(k.excluded, false) and s.publisher_name is not null;

create or replace view contract.licence as
with labels as (
  select distinct s.licence_code as code from public.contract_sources s where s.licence_code is not null
)
select l.code                                                        as licence_code,
       l.code                                                        as licence_name,
       coalesce(
         (select min(r.licence_url) from public.registered_sources r where r.licence_label = l.code),
         case
           when l.code ~* '^CC BY-SA 4\.0'   then 'https://creativecommons.org/licenses/by-sa/4.0/'
           when l.code ~* '^CC BY 4\.0'      then 'https://creativecommons.org/licenses/by/4.0/'
           when l.code ~* '^CC BY 3\.0 DE'   then 'https://creativecommons.org/licenses/by/3.0/de/'
           when l.code ~* '^CC0'             then 'https://creativecommons.org/publicdomain/zero/1.0/'
           when l.code ~* 'ODbL'             then 'https://opendatacommons.org/licenses/odbl/1-0/'
           when l.code ~* '(Zero|zero-2-0)'  then 'https://www.govdata.de/dl-de/zero-2-0'
           when l.code ~* '(Namensnennung|by-2-0)' then 'https://www.govdata.de/dl-de/by-2-0'
           when l.code ~* 'GeoNutzV'         then 'https://www.gesetze-im-internet.de/geonutzv/'
         end,
         -- A licence no document names (an offer's licence class, statutory
         -- AFIR data, an operator's terms): the one source page that states
         -- it, when one source alone carries the label.
         (select min(s.terms_url) from public.contract_sources s where s.licence_code = l.code
           having count(distinct s.terms_url) = 1))                  as licence_url,
       case
         when l.code ~* '(CC0|Zero|zero-2-0)'           then 'public_domain'
         when l.code ~* '(BY-SA|ODbL)'                  then 'share_alike'
         when l.code ~* '(CC BY|Namensnennung|by-2-0|GeoNutzV)' then 'attribution'
         when l.code ~* 'pending'                       then 'pending'
         else 'terms'
       end                                                           as licence_category,
       l.code ~* '(BY-SA|ODbL)'                                      as share_alike,
       not (l.code ~* '(CC0|Zero|zero-2-0)')                         as attribution_required
  from labels l;

create or replace view contract.source as
with s as (
  select s.source_ref                                       as source_ref,
         d.domain                                           as domain,
         s.source_ref                                       as publisher_id,
         s.licence_code                                     as licence_code,
         s.attribution_text                                 as attribution_text,
         g.changes_statement                                as changes_statement,
         s.terms_url                                        as terms_url,
         null::text                                         as share_alike_offer_url,
         s.acceptance_required                              as acceptance_required,
         -- A source the rulings restrict (consumer_only, no_redistribution,
         -- gated) keeps only the consumer class of its licence's classes.
         case when coalesce(k.display_class, 'open') = 'open' then coalesce(g.use_classes, '{}')
              else array(select u from unnest(coalesce(g.use_classes, '{}')) u where u = 'consumer') end as use_classes,
         coalesce(s.cadence_s, f.cadence_s, 31536000)       as freshness_target_s,
         3 * coalesce(s.cadence_s, f.cadence_s, 31536000)   as stale_after_s,
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
 where not coalesce(s.excluded, false);

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
select g.id::text as place_id, g.name as label, null::text as lang, 'name'::text as name_kind, g.name_norm as search_fold,
       g.source_id as source_ref, 'open'::text as display_class, 'public'::text as audience
  from public.gazetteer_places g
 where g.geom is not null
union all
select g.id::text, g.name_en, 'en', 'exonym', lower(g.name_en), g.source_id, 'open', 'public'
  from public.gazetteer_places g
 where g.geom is not null and g.name_en is not null;

-- autobahn_roads is the Autobahn GmbH API's road list: its rule applies.
create or replace view contract.road as
select r.road                                  as road_ref,
       'motorway'::text                        as road_class,
       r.road                                  as name,
       null::numeric(6,1)                      as length_km,
       null::geometry(MultiLineString, 4326)   as geometry,
       null::text[]                            as states,
       'autobahn'::text                        as source_ref,
       coalesce(k.display_class, 'open')       as display_class,
       coalesce(k.audience, 'public')          as audience
  from public.autobahn_roads r
  left join lateral (select k.* from public.contract_source_rules k where 'autobahn' ~ k.pattern order by k.priority limit 1) k on true;

-- tmc_locations names no source key of its own (BASt LCL, lcl_version only).
create or replace view contract.junction as
select t.cid || ':' || t.tabcd || ':' || t.lcd                as junction_id,
       t.road_number                                          as road_ref,
       t.junction_no                                          as number,
       t.name                                                 as name,
       case t.stcd when 1 then 'interchange' when 2 then 'triangle' else 'junction' end as junction_kind,
       null::numeric(6,1)                                     as chainage_km,
       t.geom::geometry(Point, 4326)                          as location,
       null::text                                             as state_code,
       null::text                                             as source_ref,
       'open'::text                                           as display_class,
       'public'::text                                         as audience
  from public.tmc_locations t
 where t.cid = 58 and t.tabcd = 1 and t.tcd = 1
   and t.road_number ~ '^A[1-9][0-9]{0,2}$'
   and t.geom is not null and t.name is not null;

-- ----------------------------------------------------------------- roads

-- Autobahn GmbH: the events of the newest sweep of each road and kind (an
-- event that left the sweep is no longer current); its payload, where the
-- tick stores none, is the newest same-day tick of the same item with the
-- same hash, exactly as autobahn_raw_resolve() reads it.
-- DATEX II (Mobilithek): every row of road_events we did not retract, with
-- the provider's own end as withdrawn_at and its marking as confidentiality.
create or replace view contract.traffic_event as
with newest as (
  select e.road, e.kind, max(e.observed_at) as at
    from public.autobahn_events e
   where e.observed_at > now() - interval '1 day'
   group by e.road, e.kind
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
           when a.abnormal_traffic_type is not null then 'jam'
           when a.kind = 'warning' then 'hazard'
           else 'other'
         end                                                         as event_kind,
         case when a.kind like 'closure%' then 'road_closed' else 'other' end as severity,
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
           when e.event_type ~* 'accident' then 'accident'
           when e.event_type ~* 'abnormaltraffic' then 'jam'
           when e.event_type ~* '(weather|environment)' then 'weather'
           when e.event_type ~* '(closure|carriagewayorlanemanagement)' then 'closure'
           when e.event_type ~* '(speedmanagement|restriction|reroutingmanagement)' then 'restriction'
           when e.event_type ~* '(obstruction|hazard|animal|vehicle|equipment)' then 'hazard'
           else 'other'
         end,
         'other',
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
       coalesce(k.audience, 'public')                   as audience
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
select p.source_feed || ':' || p.point_key                as point_id,
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
       p.confidentiality                                  as confidentiality
  from public.charging_points p
  left join lateral (select k.* from public.contract_source_rules k where p.source_feed ~ k.pattern order by k.priority limit 1) k on true
 where p.deleted_at is null and p.site_id is not null and not coalesce(k.excluded, false);

create or replace view contract.charge_point_state_observation as
select s.source_feed || ':' || s.evse_id                  as point_id,
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
-- facility says acceptance_required, its terms gate and its hold.
create or replace view contract.parking_facility as
with f as (
  select 'p:' || id as facility_id, name, kind, operator, road, geom, false as sid, source_feed, external_id,
         first_seen_at, updated_at, last_seen_at, closed_at, confidentiality
    from public.parking_facilities where deleted_at is null
  union all
  select 'bysa:' || id, name, kind, operator, road, geom, false, source_feed, external_id,
         first_seen_at, updated_at, last_seen_at, closed_at, confidentiality
    from public.parking_facilities_bysa
  union all
  select 'odbl:' || id, name, kind, operator, road, geom, false, source_feed, external_id,
         first_seen_at, updated_at, last_seen_at, closed_at, confidentiality
    from public.parking_facilities_odbl
  union all
  select 'sid:' || id, name, kind, null, null, geom, true, source_feed, external_id,
         first_seen_at, updated_at, last_seen_at, closed_at, confidentiality
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
       k.hold_reason                                     as hold_reason
  from f
  left join lateral (select k.* from public.contract_source_rules k where f.source_feed ~ k.pattern order by k.priority limit 1) k on true
 where f.geom is not null and not coalesce(k.excluded, false);

create or replace view contract.occupancy_observation as
with o as (
  select 'p:' || facility_id as facility_id, observed_at, spaces_free, spaces_total, status, source_feed, confidentiality
    from public.parking_occupancy
  union all
  select 'odbl:' || facility_id, observed_at, spaces_free, spaces_total, status, source_feed, confidentiality
    from public.parking_occupancy_odbl
  union all
  select 'sid:' || facility_id, observed_at, spaces_free, spaces_total, status, source_feed, confidentiality
    from public.parking_occupancy_sid
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
       lower(s.name)                                      as search_fold,
       f.source_feed                                      as source_ref,
       s.id                                               as origin_key,
       f.created_at                                       as recorded_at,
       f.updated_at                                       as changed_at,
       null::timestamptz                                  as withdrawn_at,
       array[f.source_feed]                               as source_refs,
       'open'::text                                       as display_class,
       'public'::text                                     as audience
  from public.stops s
  join public.feeds f on f.gtfs_feed_key = s.gtfs_feed_key
  left join public.transit_stop_modes m on m.gtfs_feed_key = s.gtfs_feed_key and m.root_id = s.id
 where s.deleted_at is null and s.geom is not null and s.name is not null
   and (s.location_type = 1 or (coalesce(s.location_type, 0) = 0 and s.parent_id is null));

create or replace view contract.stop_point as
select s.gtfs_feed_key || ':' || s.id                         as stop_point_id,
       s.gtfs_feed_key || ':' || coalesce(s.parent_id, s.id)  as stop_place_id,
       nullif(btrim(s.platform_code), '')                     as platform_label,
       f.source_feed                                          as source_ref,
       'open'::text                                           as display_class,
       'public'::text                                         as audience
  from public.stops s
  join public.feeds f on f.gtfs_feed_key = s.gtfs_feed_key
 where s.deleted_at is null and coalesce(s.location_type, 0) = 0;

create or replace view contract.transit_line as
select r.gtfs_feed_key || ':' || r.id                                         as line_id,
       coalesce(nullif(btrim(r.short_name), ''), nullif(btrim(r.long_name), ''), r.id) as line_name,
       case
         when r.route_type = 109 then 'sbahn'
         when r.route_type = 2 or r.route_type between 100 and 199 then 'rail'
         when r.route_type = 1 or r.route_type between 400 and 405 then 'subway'
         when r.route_type = 0 or r.route_type between 900 and 906 then 'tram'
         when r.route_type in (3, 11, 800) or r.route_type between 200 and 209 or r.route_type between 700 and 716 then 'bus'
         when r.route_type = 4 or r.route_type between 1000 and 1021 or r.route_type = 1200 then 'ferry'
         else 'other'
       end                                                                    as transport_mode,
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

-- ------------------------------------------------------------- stations

create or replace view contract.station_facility as
select 'equipment:' || e.equipment_id                               as facility_id,
       '1:' || e.stop_place_id                                      as stop_place_id,
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
       null,
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

-- ------------------------------------------------------------- comments

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('publisher', 'One row per source of contract.source (public.contract_sources): publisher_id is the source key, display_name the feed title, or for a register-only source its attribution line. website: no source.'),
    ('licence', 'One row per licence label of a contract source. licence_url: the registered URL, else the canonical URL of a CC, ODbL, Datenlizenz Deutschland or GeoNutzV label, else the one source page that states a licence no document names, else NULL; category, share_alike and attribution_required are read off the label.'),
    ('source', 'One row per source of public.contract_sources (feeds, ingestor sources, the register''s static sources), with the envelope of public.contract_source_rules and the domain of public.contract_source_domains. Attribution, changes_statement, use_classes (empty = no use permitted: an unregistered source), review_signed_on and register_version from public.source_register (0309). stale_after_s is the platform''s rule, 3 x cadence (the catalogue''s, else control.data_status); a source with no cadence anywhere (static reference data) takes one year. share_alike_offer_url: no source.'),
    ('source_freshness', 'control.data_status per ledger key: data_as_of = last change seen, confirmed_at = last success, updates_paused = the gate''s pause.'),
    ('admin_region', 'public.ags_regions (Land, Kreis). boundary: no source (ags_regions holds a point).'),
    ('place', 'public.gazetteer_places with a location (OSM is excluded by that table''s own constraint). published_at: no source.'),
    ('place_alias', 'The name and the English name of each place.'),
    ('road', 'public.autobahn_roads (Autobahn GmbH API). length_km, geometry, states: no source.'),
    ('junction', 'BASt TMC junction points (public.tmc_locations, class P1) of the A-roads, chainage_km, state_code, source_ref: no source.'),
    ('traffic_event', 'The current Autobahn GmbH events (newest sweep per road and kind) and the DATEX II road events we did not retract, with the publisher''s confidentiality. lanes, length and direction: no source; is_blocked, traffic_type, delay_s only on Autobahn rows.'),
    ('traffic_event_observation', 'Every Autobahn tick and every DATEX II tick of an event we did not retract. version_no: Autobahn ticks have none (NULL).'),
    ('fuel_station', 'public.fuel_stations we did not retract. open_state_at: no source.'),
    ('fuel_product', 'public.fuel_products.'),
    ('fuel_price_observation', 'Every public.fuel_prices tick of a permitted source.'),
    ('charging_site', 'public.charging_sites with a location that we did not retract. operator_is_person: no source.'),
    ('charge_point', 'public.charging_points of a site that we did not retract.'),
    ('charge_point_state_observation', 'Every public.charging_point_status tick; point_id is the status feed and the EVSE id.'),
    ('parking_facility', 'The four parking families (p:, bysa:, odbl:, sid:) we did not retract; SID facilities are gated and held. direction: no source.'),
    ('occupancy_observation', 'Every tick of parking_occupancy, _odbl and _sid, keyed like parking_facility.'),
    ('stop_place', 'Stations and parentless stops of the static GTFS; modes from transit_stop_modes. withdrawn_at: no source.'),
    ('stop_point', 'Every boarding stop of the static GTFS.'),
    ('transit_line', 'public.routes; transport_mode as transit_stop_modes types it.'),
    ('journey', 'A trip on each of its service dates. extra: the static timetable has no extra trips (false).'),
    ('scheduled_call', 'public.stop_times on each service date of its trip, in absolute time.'),
    ('call_observation', 'DELFI GTFS-RT stop-time ticks (CC BY-SA), expected = planned + delay on the tick''s Berlin date.'),
    ('station_facility', 'Lifts and escalators of DB OpenStation and KVB with their state, and DB FaSta. stop_place_id: FaSta names a DB station number, not a stop (NULL).'),
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
