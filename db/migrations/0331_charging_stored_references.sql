-- charging_site_twin_claims and charging_point_copies: the two neighbour rules
-- of the charging reads, kept by the loads instead of worked out by every read.
--
-- 1. The register-twin claim (the main repository's registerTwinSql). A
--    register site gives way to a site of another feed when, among other
--    tests, the two lie within 50 m and share an operator or an address, or
--    within 150 m and share both, and an address match only counts when no
--    register site within 50 m of the other site names its operator (the
--    veto). That part of the rule reads nothing but site rows, so it is kept
--    here per candidate pair of charging_site_twin_pairs (0326). The tests that
--    depend on the reader stay in the reader: the other site inside the
--    reader's circle, its feed licensed, the site open and publishable and
--    holding a live point.
--
-- 2. The better copy. A point another feed also publishes (the same EVSE id
--    without '*' and '-', or the same UUID point id) is listed once, by the
--    feed the reader ranks first, when both copies are in the reader's circle.
--    The reads found the copies with window functions over every point in the
--    circle. A row here is a live, publishable point and one other live,
--    publishable point with the same key; the reader keeps the rank and the
--    circle.
--
-- refresh_charging_derived(feed): rebuilds the claims of the pairs on either
-- side of that feed and the copies with a point of that feed on either side.
-- Every charging loader calls it after refresh_charging_twin_pairs(feed), in
-- the same transaction, after its last write. It takes the pairs' advisory
-- lock (0326), so it runs after any refresh in flight and one at a time.
-- Rows that still hold are left in place (delete what went, insert what is
-- new), so a load that changed nothing writes nothing.
--
-- Lock: create table, create index on the new tables, create function; the
-- first fill reads charging_sites, charging_points and the pairs (ACCESS
-- SHARE, blocks no writer) and runs feed by feed.
--
-- rollback:
--   drop function public.refresh_charging_derived(text);
--   drop function public.charging_point_copy_keys(text);
--   drop table public.charging_point_copies;
--   drop table public.charging_site_twin_claims;
--   delete from schema_migrations where version = 331;
set local lock_timeout = '5s';

create table public.charging_site_twin_claims (
    register_feed text not null,
    register_site_id text not null,
    twin_feed text not null,
    twin_site_id text not null,
    constraint charging_site_twin_claims_pkey primary key (register_feed, register_site_id, twin_feed, twin_site_id)
)
with (
  autovacuum_vacuum_scale_factor = 0,
  autovacuum_vacuum_threshold = 2000,
  autovacuum_vacuum_insert_scale_factor = 0,
  autovacuum_vacuum_insert_threshold = 2000,
  autovacuum_analyze_scale_factor = 0,
  autovacuum_analyze_threshold = 2000
);

create table public.charging_point_copies (
    source_feed text not null,
    point_key text not null,
    -- 'e': the same EVSE id; 'u': the same UUID point id.
    kind text not null constraint charging_point_copies_kind check (kind in ('e', 'u')),
    copy_feed text not null,
    copy_point_key text not null,
    copy_site_id text not null,
    constraint charging_point_copies_pkey primary key (source_feed, point_key, kind, copy_feed, copy_point_key)
)
with (
  autovacuum_vacuum_scale_factor = 0,
  autovacuum_vacuum_threshold = 2000,
  autovacuum_vacuum_insert_scale_factor = 0,
  autovacuum_vacuum_insert_threshold = 2000,
  autovacuum_analyze_scale_factor = 0,
  autovacuum_analyze_threshold = 2000
);
-- A refresh of a feed removes the rows naming it as the copy.
create index charging_point_copies_copy on public.charging_point_copies (copy_feed, copy_point_key);

-- The copy keys of the live, publishable points: of one feed, or of all with null.
create function public.charging_point_copy_keys(p_feed text)
    returns table (kind text, norm text, source_feed text, point_key text, site_id text)
    language sql stable parallel safe
    set search_path to 'public', 'pg_temp'
    as $$
  select 'e', upper(translate(p.evse_id, '*-', '')), p.source_feed, p.point_key, p.site_id
    from charging_points p
   where p.deleted_at is null and p.closed_at is null
     and coalesce(p.confidentiality, 'noRestriction') = 'noRestriction'
     and p.evse_id is not null
     and (p_feed is null or p.source_feed = p_feed)
  union all
  select 'u', lower(p.provider_point_id), p.source_feed, p.point_key, p.site_id
    from charging_points p
   where p.deleted_at is null and p.closed_at is null
     and coalesce(p.confidentiality, 'noRestriction') = 'noRestriction'
     and p.provider_point_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     and (p_feed is null or p.source_feed = p_feed)
$$;

create function public.refresh_charging_derived(p_feed text) returns integer
    language plpgsql security definer
    set search_path to 'public', 'pg_temp'
    as $$
declare
  n integer := 0;
  k integer;
begin
  if p_feed is null or p_feed = '' then
    raise exception 'refresh_charging_derived: name the feed whose rows were loaded' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('public.charging_site_twin_pairs', 0));

  -- 1. The claims of the pairs with this feed on either side.
  with fresh as materialized (
    select tp.register_feed, tp.register_site_id, tp.twin_feed, tp.twin_site_id
      from charging_site_twin_pairs tp
      join charging_sites n on n.source_feed = tp.register_feed and n.site_id = tp.register_site_id
      join charging_sites a on a.source_feed = tp.twin_feed and a.site_id = tp.twin_site_id
     where (tp.register_feed = p_feed or tp.twin_feed = p_feed)
       and ST_DWithin(a.geom, n.geom, 150)
       and ((ST_DWithin(a.geom, n.geom, 50)
             and (a.operator_tokens && n.operator_tokens
                  or (a.street_key <> ''
                      and a.street_key = n.street_key
                      and (a.postcode is null or n.postcode is null or a.postcode = n.postcode)
                      and (a.house_key is null or n.house_key is null or a.house_key = n.house_key)
                      and not exists (
                        select 1
                          from charging_site_twin_pairs cp
                          join charging_sites r on r.source_feed = cp.register_feed and r.site_id = cp.register_site_id
                         where cp.twin_feed = a.source_feed and cp.twin_site_id = a.site_id
                           and r.deleted_at is null and not r.access_private
                           and r.closed_at is null
                           and r.source_feed = any (charging_twin_register_feeds())
                           and coalesce(r.confidentiality, 'noRestriction') = 'noRestriction'
                           and ST_DWithin(r.geom, a.geom, 50)
                           and r.operator_tokens && a.operator_tokens))))
            or (a.operator_tokens && n.operator_tokens
                and a.street_key <> ''
                and a.street_key = n.street_key
                and a.house_key is not null
                and a.house_key = n.house_key
                and (a.postcode is null or n.postcode is null or a.postcode = n.postcode)))
  ),
  gone as (
    delete from charging_site_twin_claims c
     where (c.register_feed = p_feed or c.twin_feed = p_feed)
       and not exists (select 1 from fresh f
                        where f.register_feed = c.register_feed and f.register_site_id = c.register_site_id
                          and f.twin_feed = c.twin_feed and f.twin_site_id = c.twin_site_id)
  )
  insert into charging_site_twin_claims select * from fresh on conflict do nothing;
  get diagnostics k = row_count;
  n := n + k;

  -- 2. The copies with a point of this feed on either side.
  with mine as materialized (select * from charging_point_copy_keys(p_feed)),
  fresh as materialized (
    select m.source_feed, m.point_key, m.kind, o.source_feed as copy_feed, o.point_key as copy_point_key, o.site_id as copy_site_id
      from mine m join charging_point_copy_keys(null) o on o.kind = m.kind and o.norm = m.norm
     where not (o.source_feed = m.source_feed and o.point_key = m.point_key)
    union
    select o.source_feed, o.point_key, o.kind, m.source_feed, m.point_key, m.site_id
      from mine m join charging_point_copy_keys(null) o on o.kind = m.kind and o.norm = m.norm
     where not (o.source_feed = m.source_feed and o.point_key = m.point_key)
  ),
  gone as (
    delete from charging_point_copies c
     where (c.source_feed = p_feed or c.copy_feed = p_feed)
       and not exists (select 1 from fresh f
                        where f.source_feed = c.source_feed and f.point_key = c.point_key and f.kind = c.kind
                          and f.copy_feed = c.copy_feed and f.copy_point_key = c.copy_point_key)
  )
  insert into charging_point_copies select * from fresh
  on conflict (source_feed, point_key, kind, copy_feed, copy_point_key) do update set copy_site_id = excluded.copy_site_id
   where charging_point_copies.copy_site_id is distinct from excluded.copy_site_id;
  get diagnostics k = row_count;
  return n + k;
end $$;

comment on table public.charging_site_twin_claims is 'The register-twin rule''s site-only part per candidate pair (0331): within 150 m, and within 50 m sharing an operator or an address the veto leaves, or sharing both. Kept by refresh_charging_derived(feed); the reader adds the circle, the licence and the other site''s liveness.';
comment on table public.charging_point_copies is 'Each live, publishable charging point and every other one with the same EVSE id (kind e) or UUID point id (kind u) (0331). Kept by refresh_charging_derived(feed); the reader adds the rank and the circle.';
comment on function public.refresh_charging_derived(text) is 'Rebuilds the twin claims and point copies touching this feed; every charging loader calls it after refresh_charging_twin_pairs(feed), in its transaction (0331).';

revoke all on function public.refresh_charging_derived(text) from public;
revoke all on function public.charging_point_copy_keys(text) from public;
grant execute on function public.refresh_charging_derived(text) to viafrei_ingestor;
grant select on public.charging_site_twin_claims, public.charging_point_copies to viafrei_digest, viafrei_mcp;

-- The first fill, feed by feed (each call reads only what touches its feed).
do $$
declare
  f text;
begin
  for f in select distinct source_feed from charging_sites order by 1 loop
    perform refresh_charging_derived(f);
  end loop;
end $$;
