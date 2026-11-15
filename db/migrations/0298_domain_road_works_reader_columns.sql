-- domains.road_works: the columns its readers use on the old
-- public.opendata_roadworks and the domain does not have yet (the comparison of
-- road_works, route_recommendations and speed_cameras with their old tables).
--
-- Read today through opendata_roadworks_live and not yet here: kind,
-- place_text, organisation, closure, affects_traffic, answerable,
-- day_precision, period_text, link, closure_starts_at, closure_ends_at,
-- last_seen_at and anchor. The old
-- detail_text is description, site_id is external_id, source_feed is
-- source_id and feed, title, starts_at and ends_at keep their names.
--
-- anchor is generated from geom by the same rule the old loader uses (the
-- point of the shape nearest its centroid), so a writer never writes it and
-- it cannot disagree with geom. The three flags have no default: a writer
-- that does not know sets null, and a reader takes null as the old table's
-- default (closure false, affects_traffic true, answerable true, day_precision
-- false).
--
-- Not added, because no reader uses them: road_number, planned_layer, props,
-- content_hash, closure_window_rule. The
-- version history public.opendata_roadwork_versions has no reader and gets no
-- domain twin.
--
-- speed_cameras and route_recommendations need nothing: no reader uses a
-- column of public.speed_enforcement that speed_cameras lacks (nothing reads
-- it), and route_recommendations has no old table.
--
-- The merged view expands its columns when it is created, so it is dropped and
-- created again over the new shape, with its grant.
--
-- rollback: drop view domains.road_works_merged; drop index domains.road_works_anchor;
--   alter table domains.road_works drop column anchor, drop column last_seen_at,
--   drop column closure_ends_at, drop column closure_starts_at,
--   drop column link, drop column period_text, drop column day_precision,
--   drop column answerable, drop column affects_traffic, drop column closure,
--   drop column organisation, drop column place_text, drop column kind;
--   then create road_works_merged again as the baseline made it (0293) and
--   grant select on it to viafrei_ingestor;
--   delete from schema_migrations where version = 298;

drop view domains.road_works_merged;

alter table domains.road_works
  add column kind text,
  add column place_text text,
  add column organisation text,
  add column closure boolean,
  add column affects_traffic boolean,
  add column answerable boolean,
  add column day_precision boolean,
  add column period_text text,
  add column link text,
  add column closure_starts_at timestamptz,
  add column closure_ends_at timestamptz,
  add column last_seen_at timestamptz,
  add column anchor geometry(Point, 4326) generated always as (ST_ClosestPoint(geom, ST_Centroid(geom))) stored,
  add constraint road_works_kind check (kind is null or kind in ('roadworks', 'event', 'message')),
  add constraint road_works_period_ordered check (starts_at is null or ends_at is null or starts_at <= ends_at),
  add constraint road_works_closure_window_ordered check (closure_starts_at is null or closure_ends_at is null or closure_starts_at < closure_ends_at);

comment on column domains.road_works.kind is 'roadworks, event or message.';
comment on column domains.road_works.place_text is 'Where, as the publisher words it.';
comment on column domains.road_works.organisation is 'Who carries out the work, as published.';
comment on column domains.road_works.closure is 'True when the road is closed; null when nothing says (read as false).';
comment on column domains.road_works.affects_traffic is 'False when the publisher says the work does not touch traffic; null read as true.';
comment on column domains.road_works.answerable is 'False when the row is held but not shown in an answer; null read as true.';
comment on column domains.road_works.day_precision is 'True when starts_at and ends_at are whole Berlin days; ends_at is then the midnight after the last day. Null read as false.';
comment on column domains.road_works.period_text is 'The period as the publisher words it.';
comment on column domains.road_works.link is 'The publisher''s page for the work.';
comment on column domains.road_works.closure_starts_at is 'When the closure begins, when the publisher''s words date it apart from the work''s period.';
comment on column domains.road_works.closure_ends_at is 'When the closure ends, as closure_starts_at.';
comment on column domains.road_works.last_seen_at is 'The last run that saw the work in its source, set by the writer on every run (observed_at moves only when the row changes).';
comment on column domains.road_works.anchor is 'The point of geom nearest its centroid, generated: the point a work is measured and drawn from.';

create index road_works_anchor on domains.road_works using gist (anchor) where closed_at is null;

-- One merged entity per match key, the winner by source trust and then the
-- freshest, every contributing source attributed.
create view domains.road_works_merged as
with live as (
  select r.*, coalesce(r.match_key, r.source_id || '|' || r.feed || '|' || r.external_id) as entity_key,
         s.trust, s.attribution, s.licence_id
    from domains.road_works r left join ingestor.sources s on s.id = r.source_id
   where r.closed_at is null
), ranked as (
  select l as w,
         row_number() over (partition by l.entity_key order by l.trust desc nulls last, l.observed_at desc, l.source_id, l.external_id) as rn,
         jsonb_agg(jsonb_build_object('source_id', l.source_id, 'feed', l.feed, 'external_id', l.external_id,
                                      'attribution', l.attribution, 'licence_id', l.licence_id, 'observed_at', l.observed_at))
           over entity as sources,
         count(*) over entity as source_count
    from live l
  window entity as (partition by l.entity_key order by l.source_id, l.feed, l.external_id
                    rows between unbounded preceding and unbounded following)
)
select (k.w).*, k.sources, k.source_count::int as source_count
  from ranked k where k.rn = 1;
grant select on domains.road_works_merged to viafrei_ingestor;
