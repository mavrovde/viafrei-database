-- charging_site_twin_pairs: the candidate pairs of the register-twin rule,
-- kept by the loads instead of searched for by every read.
--
-- The rule (the main repository's registerTwinSql): a site of a register feed
-- (the Ladesaeulenregister, bnetza_lsr) is not listed when a live, licensed,
-- publishable site of another feed lies inside the answer's circle, within
-- 50 m and of the same operator or address, or within 150 m and of the same
-- operator AND address, and holds a live point. An address match counts only
-- when no register site within 50 m names that site's operator (the claim
-- rule). The reads found the candidates with a spatial search per register
-- site (the card, the corridor) or a grid window over the whole circle (the
-- radius read and the facets): the larger part of the charging reads' cost on
-- production on 2026-11-22.
--
-- A row here is a register site and a site of another feed that are open,
-- within 150 m of each other, and share an operator token or a non-empty
-- street key. Every arm of the rule, and the claim rule read the other way
-- round, needs both, so the rows are a SUPERSET of the pairs any read can
-- accept: the reads still test every condition of the rule on the live rows
-- they join through these keys, so a row that no longer holds (a site closed,
-- soft-deleted, moved) only costs a probe. What must never happen is a pair
-- missing, and the rows change only through a load: every charging loader
-- calls refresh_charging_twin_pairs(feed) for its feed, inside its own
-- transaction, after its last write.
--
-- refresh_charging_twin_pairs(feed): for a register feed, rebuilds the rows of
-- its sites; for any other feed, the rows of its sites. A pair depends on both
-- feeds' rows, so the refreshes take ONE transaction-scoped advisory lock and
-- run one at a time: a refresh that waited sees the rows of the load that held
-- it (each statement takes a new snapshot), and two loads of different feeds
-- cannot each miss the other's new sites. Rows that still hold are left in
-- place (delete what went, insert what is new), so a load that changed nothing
-- writes nothing. Production, read-only on 2026-11-22: 75 316 register sites,
-- 152 368 pairs, the register's rebuild 10.9 s.
--
-- The register feeds are the function charging_twin_register_feeds(); the
-- reads pass their own list ($16 in the main repository) and the main
-- repository's tests hold it to a subset of this one.
--
-- Lock: create table, create index on the new table, create function; then the
-- first fill reads charging_sites (ACCESS SHARE, blocks no writer). The fill
-- is the register's rebuild, which pairs every register site with every other
-- feed's sites, so it is the whole table.
--
-- rollback:
--   drop function public.refresh_charging_twin_pairs(text);
--   drop function public.charging_twin_register_feeds();
--   drop table public.charging_site_twin_pairs;
--   delete from schema_migrations where version = 326;

set local lock_timeout = '5s';

create table public.charging_site_twin_pairs (
    register_feed text not null,
    register_site_id text not null,
    twin_feed text not null,
    twin_site_id text not null,
    constraint charging_site_twin_pairs_pkey primary key (register_feed, register_site_id, twin_feed, twin_site_id)
)
-- A load rewrites only the pairs that changed; a register release can replace
-- tens of thousands at once. Fixed thresholds rather than a share of the table,
-- so a small change is not left for autovacuum to find hours later.
with (
  autovacuum_vacuum_scale_factor = 0,
  autovacuum_vacuum_threshold = 2000,
  autovacuum_vacuum_insert_scale_factor = 0,
  autovacuum_vacuum_insert_threshold = 2000,
  autovacuum_analyze_scale_factor = 0,
  autovacuum_analyze_threshold = 2000
);

-- The claim rule reads the pairs from the other side: the register sites a
-- candidate twin has.
create index charging_site_twin_pairs_twin on public.charging_site_twin_pairs (twin_feed, twin_site_id);

create function public.charging_twin_register_feeds() returns text[]
    language sql immutable parallel safe
    as $$ select '{bnetza_lsr}'::text[] $$;

create function public.refresh_charging_twin_pairs(p_feed text) returns integer
    language plpgsql security definer
    set search_path to 'public', 'pg_temp'
    as $$
declare
  n integer;
begin
  if p_feed is null or p_feed = '' then
    raise exception 'refresh_charging_twin_pairs: name the feed whose sites were loaded' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('public.charging_site_twin_pairs', 0));
  if p_feed = any (charging_twin_register_feeds()) then
    with fresh as materialized (
      select r.source_feed as register_feed, r.site_id as register_site_id, a.source_feed as twin_feed, a.site_id as twin_site_id
        from charging_sites r
        cross join lateral (
          select a.source_feed, a.site_id
            from charging_sites a
           where a.closed_at is null
             and not (a.source_feed = any (charging_twin_register_feeds()))
             and ST_DWithin(a.geom, r.geom, 150)
             and (a.operator_tokens && r.operator_tokens or (a.street_key <> '' and a.street_key = r.street_key))
        ) a
       where r.source_feed = p_feed and r.closed_at is null
    ),
    gone as (
      delete from charging_site_twin_pairs p
       where p.register_feed = p_feed
         and not exists (select 1 from fresh f
                          where f.register_site_id = p.register_site_id and f.twin_feed = p.twin_feed and f.twin_site_id = p.twin_site_id)
    )
    insert into charging_site_twin_pairs select * from fresh on conflict do nothing;
  else
    with fresh as materialized (
      select r.source_feed as register_feed, r.site_id as register_site_id, a.source_feed as twin_feed, a.site_id as twin_site_id
        from charging_sites a
        cross join lateral (
          select r.source_feed, r.site_id
            from charging_sites r
           where r.closed_at is null
             and r.source_feed = any (charging_twin_register_feeds())
             and ST_DWithin(r.geom, a.geom, 150)
             and (a.operator_tokens && r.operator_tokens or (a.street_key <> '' and a.street_key = r.street_key))
        ) r
       where a.source_feed = p_feed and a.closed_at is null
    ),
    gone as (
      delete from charging_site_twin_pairs p
       where p.twin_feed = p_feed
         and not exists (select 1 from fresh f
                          where f.register_feed = p.register_feed and f.register_site_id = p.register_site_id and f.twin_site_id = p.twin_site_id)
    )
    insert into charging_site_twin_pairs select * from fresh on conflict do nothing;
  end if;
  get diagnostics n = row_count;
  return n;
end $$;

comment on table public.charging_site_twin_pairs is 'The register-twin rule''s candidate pairs: a register site and a site of another feed, both open, within 150 m, sharing an operator token or a non-empty street key. A superset of what any read accepts; the reads test the rule on the live rows. Kept by refresh_charging_twin_pairs(feed), which every charging load calls for its feed. Migration 0326.';
comment on function public.charging_twin_register_feeds() is 'The feeds whose sites give way to a twin of another feed (the register-twin rule): the register side of charging_site_twin_pairs. Migration 0326.';
comment on function public.refresh_charging_twin_pairs(text) is 'Rebuilds the charging_site_twin_pairs rows of one feed''s sites (a register feed: its register side; any other: its twin side), one refresh at a time under a transaction-scoped advisory lock; returns the pairs inserted. Called by every charging load inside its transaction, after its last write. Migration 0326.';

revoke all on function public.refresh_charging_twin_pairs(text) from public;
grant execute on function public.refresh_charging_twin_pairs(text) to viafrei_ingestor;
grant select on public.charging_site_twin_pairs to viafrei_digest, viafrei_mcp;

select public.refresh_charging_twin_pairs(f) from unnest(public.charging_twin_register_feeds()) f;
