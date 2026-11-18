-- Two per-row costs of the contract views (0312) that a reader could not
-- avoid (#49). The answers are unchanged; only the plans change.
--
-- 1. contract_stop_place_of(ref) matched the stops filed under a DHID with
--    s.id like <prefix> || ':%'. A LIKE pattern built at run time cannot be an
--    index bound, so each call read every stop: about 3 ms per facility, and
--    a filter or a count over contract.station_facility paid it on every row.
--    The prefix match is now the byte range [<prefix>':', <prefix>';') with
--    the text_pattern_ops operators, which is what stops_id_prefix
--    (gtfs_feed_key, id text_pattern_ops) indexes: ';' is the byte after ':',
--    so a stop id lies in that range exactly when it starts with
--    <prefix>':'. The prefix is digits, letters and colons only, which LIKE
--    reads literally, so the match is the one LIKE made.
--
--    It stays a security definer. api_reader reads no platform table, and a
--    view calls a function with its reader's rights, so a plain function
--    would refuse it; and a scalar SQL function whose body is a subquery is
--    never inlined, so a plain function would not plan any better either.
--
-- 2. contract.road joined contract_road_shape(road) (about 13 ms a road) with
--    cross join lateral, which PostgreSQL evaluates for every road whether or
--    not the query reads geometry, length_km, states or source_refs. The
--    shape now comes from a left join on a subquery that is distinct on the
--    road: a query that reads no shape column has that join removed by the
--    planner (left join removal needs a provably unique inner side, hence
--    the distinct on), and a filter on road_ref still reaches the subquery,
--    so one road costs one shape. autobahn_roads is keyed on road and
--    contract_road_shape returns one row for every road (its out columns NULL
--    when the LCL holds no chain), so the left join pairs each road with
--    exactly the row the cross join did. Column names, types and order are
--    0312's.
--
-- rollback: re-run 0312's create function public.contract_stop_place_of as
-- create or replace function, and its create or replace view contract.road;
--   delete from schema_migrations where version = 316;

-- create or replace view takes an ACCESS EXCLUSIVE lock on the view.
set local lock_timeout = '5s';

create or replace function public.contract_stop_place_of(ref text) returns text
  language sql stable strict parallel safe security definer set search_path = pg_catalog, public
  return (select '1:' || s.id from public.stops s
           where s.gtfs_feed_key = 1 and s.deleted_at is null
             and (s.id = substring(ref from '^(?:dhid:)?([a-z]{2}:[0-9]{5}:[0-9]+)')
                  or s.id operator(pg_catalog.~>=~) (substring(ref from '^(?:dhid:)?([a-z]{2}:[0-9]{5}:[0-9]+)') || ':')
                     and s.id operator(pg_catalog.~<~) (substring(ref from '^(?:dhid:)?([a-z]{2}:[0-9]{5}:[0-9]+)') || ';'))
             and (s.location_type = 1 or (s.location_type = 0 and s.parent_id is null))
           order by s.id = substring(ref from '^(?:dhid:)?([a-z]{2}:[0-9]{5}:[0-9]+)') desc, s.id
           limit 1);

create or replace view contract.road as
select r.road                                  as road_ref,
       'motorway'::text                        as road_class,
       r.road                                  as name,
       l.length_km::numeric(6,1)               as length_km,
       l.line::geometry(MultiLineString, 4326) as geometry,
       l.states                                as states,
       'autobahn'::text                        as source_ref,
       coalesce(k.display_class, 'open')       as display_class,
       coalesce(k.audience, 'public')          as audience,
       case when l.line is null then array['autobahn'] else array['autobahn', 'bast_lcl'] end as source_refs
  from public.autobahn_roads r
  left join (select distinct on (s.road) s.road, f.line, f.length_km, f.states
               from public.autobahn_roads s
               cross join lateral public.contract_road_shape(s.road) f) l on l.road = r.road
  left join lateral (select k.* from public.contract_source_rules k where 'autobahn' ~ k.pattern order by k.priority limit 1) k on true;
