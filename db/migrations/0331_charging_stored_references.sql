-- charging_site_twin_claims: the register-twin rule's site-only part, kept by
-- the loads instead of worked out by every read.
--
-- A register site gives way to a site of another feed (the main repository's
-- registerTwinSql) when, among other tests, the two lie within 50 m and share
-- an operator or an address, or within 150 m and share both, and an address
-- match only counts when no register site within 50 m of the other site names
-- its operator (the veto). That part of the rule reads nothing but site rows,
-- so it is kept here per candidate pair of charging_site_twin_pairs (0326).
-- The tests that depend on the reader stay in the reader: the other site
-- inside the reader's circle, its feed licensed, the site open and
-- publishable and holding a live point.
--
-- refresh_charging_derived(feed): rebuilds the claims of the pairs on either
-- side of that feed. Every charging loader calls it after
-- refresh_charging_twin_pairs(feed), in the same transaction, after its last
-- write. It takes the pairs' advisory lock (0326), so it runs after any
-- refresh in flight and one at a time. Rows that still hold are left in place
-- (delete what went, insert what is new), so a load that changed nothing
-- writes nothing.
--
-- Order: the readers may read these rows only once every writer of
-- charging_sites calls refresh_charging_derived(feed) after
-- refresh_charging_twin_pairs(feed). Today those are the main repository's
-- loaders (afir/load.ts refreshChargingTwinPairs, which the register and the
-- Autobahn sweep also go through); viafrei-ingestor writes no charging row.
-- Before that, rows go stale after the first fill.
--
-- Lock: create table and create function on new objects; the first fill is one
-- insert that reads charging_sites and the pairs (ACCESS SHARE, blocks no
-- writer) under the pairs' advisory lock, so a load waits for it.
--
-- rollback:
--   drop function public.refresh_charging_derived(text);
--   drop function public.charging_twin_claims_of(text);
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

-- The claims of the pairs with p_feed on either side, or of every pair with
-- null. The veto reads only the other site, so it is worked out once per site
-- (vetoed), not once per pair.
create function public.charging_twin_claims_of(p_feed text)
    returns table (register_feed text, register_site_id text, twin_feed text, twin_site_id text)
    language sql stable
    set search_path to 'public', 'pg_temp'
    as $$
  with scope as materialized (
    select tp.register_feed, tp.register_site_id, tp.twin_feed, tp.twin_site_id
      from charging_site_twin_pairs tp
     where p_feed is null or tp.register_feed = p_feed or tp.twin_feed = p_feed
  ),
  -- The veto reads only the other site: a site of another feed whose operator a
  -- live, publishable register site within 50 m also names. Once per site.
  vetoed as materialized (
    select distinct cp.twin_feed, cp.twin_site_id
      from charging_site_twin_pairs cp
      join charging_sites a on a.source_feed = cp.twin_feed and a.site_id = cp.twin_site_id
      join charging_sites r on r.source_feed = cp.register_feed and r.site_id = cp.register_site_id
     where (cp.twin_feed, cp.twin_site_id) in (select s.twin_feed, s.twin_site_id from scope s)
       and r.deleted_at is null and not r.access_private
       and r.closed_at is null
       and r.source_feed = any (charging_twin_register_feeds())
       and coalesce(r.confidentiality, 'noRestriction') = 'noRestriction'
       and ST_DWithin(r.geom, a.geom, 50)
       and r.operator_tokens && a.operator_tokens
  )
  select tp.register_feed, tp.register_site_id, tp.twin_feed, tp.twin_site_id
    from scope tp
    join charging_sites n on n.source_feed = tp.register_feed and n.site_id = tp.register_site_id
    join charging_sites a on a.source_feed = tp.twin_feed and a.site_id = tp.twin_site_id
   where ST_DWithin(a.geom, n.geom, 150)
     and ((ST_DWithin(a.geom, n.geom, 50)
           and (a.operator_tokens && n.operator_tokens
                or (a.street_key <> ''
                    and a.street_key = n.street_key
                    and (a.postcode is null or n.postcode is null or a.postcode = n.postcode)
                    and (a.house_key is null or n.house_key is null or a.house_key = n.house_key)
                    and not exists (select 1 from vetoed v where v.twin_feed = a.source_feed and v.twin_site_id = a.site_id))))
          or (a.operator_tokens && n.operator_tokens
              and a.street_key <> ''
              and a.street_key = n.street_key
              and a.house_key is not null
              and a.house_key = n.house_key
              and (a.postcode is null or n.postcode is null or a.postcode = n.postcode)))
$$;

create function public.refresh_charging_derived(p_feed text) returns integer
    language plpgsql security definer
    set search_path to 'public', 'pg_temp'
    as $$
declare
  n integer;
begin
  if p_feed is null or p_feed = '' then
    raise exception 'refresh_charging_derived: name the feed whose rows were loaded' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('public.charging_site_twin_pairs', 0));

  with fresh as materialized (
    select * from charging_twin_claims_of(p_feed)
  ),
  gone as (
    delete from charging_site_twin_claims c
     where (c.register_feed = p_feed or c.twin_feed = p_feed)
       and not exists (select 1 from fresh f
                        where f.register_feed = c.register_feed and f.register_site_id = c.register_site_id
                          and f.twin_feed = c.twin_feed and f.twin_site_id = c.twin_site_id)
    returning 1
  ),
  added as (
    insert into charging_site_twin_claims select * from fresh on conflict do nothing
    returning 1
  )
  -- The rows written: those deleted plus those inserted (0 when nothing changed).
  select (select count(*) from gone) + (select count(*) from added) into n;
  return n;
end $$;

comment on table public.charging_site_twin_claims is 'The register-twin rule''s site-only part per candidate pair (0331): within 150 m, and within 50 m sharing an operator or an address the veto leaves, or sharing both. Kept by refresh_charging_derived(feed); the reader adds the circle, the licence and the other site''s liveness.';
comment on function public.charging_twin_claims_of(text) is 'The register-twin rule''s site-only part for the pairs with this feed on either side, or for every pair with null (0331); the veto once per site.';
comment on function public.refresh_charging_derived(text) is 'Rebuilds the twin claims touching this feed and returns the rows it deleted plus inserted; every charging loader calls it after refresh_charging_twin_pairs(feed), in its transaction (0331).';

revoke all on function public.refresh_charging_derived(text) from public;
revoke all on function public.charging_twin_claims_of(text) from public;
grant execute on function public.refresh_charging_derived(text) to viafrei_ingestor;
grant select on public.charging_site_twin_claims to viafrei_digest, viafrei_mcp;

-- The first fill, in one pass: every pair's claim, under the pairs' lock.
select pg_advisory_xact_lock(hashtextextended('public.charging_site_twin_pairs', 0));
insert into public.charging_site_twin_claims select * from public.charging_twin_claims_of(null);
