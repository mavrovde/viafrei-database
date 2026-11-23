-- Two gaps 0330 and 0332 left, found by the main application's tests at head 334.
--
-- 1. viafrei_mcp may read public.traffic_count_sites_live. 0332 created the view
--    for the traffic profiles near a point and granted it to viafrei_digest
--    only, but the MCP server runs the same read (check_road_status by place),
--    so on the MCP role it fails with "permission denied". viafrei_mcp already
--    reads traffic_count_profiles_live and traffic_count_now_live; the base
--    table traffic_count_sites stays forbidden to it. Every other view that
--    0330-0334 created or replaced was compared with its definition at 0329:
--    all of them keep the grants they had, so this is the only grant missing.
--
-- 2. public.road_events_current carries entry_static. 0330 appended
--    entry_static to road_events_live (road_events' columns exactly), but
--    road_events_current names road_events_live's columns one by one, so it
--    stayed at the 34 it had and lacks the new one. Root cause: a view's
--    column list is fixed when it is created, whether it is written with * or
--    by name, so a column added to the relation below never reaches it. Of the
--    views over the relations that gained columns in 0330-0334 (road_events,
--    road_events_live, autobahn_events), road_events_current is the only one
--    that carried every column of its source at 0329; the others
--    (road_event_locations_live, contract.traffic_event,
--    contract.traffic_event_observation) select chosen columns and are left as
--    they are. create or replace appends entry_static last, in the order of
--    road_events_live, and keeps the view's grants and its comment; its rows
--    are the same rows.
--
-- rollback:
--   revoke select on public.traffic_count_sites_live from viafrei_mcp;
--   (entry_static cannot be removed from road_events_current by create or
--   replace; drop and create the view at its 0330 list, with its grants and
--   comment, if it must go)
--   delete from schema_migrations where version = 335;

begin;
set local lock_timeout = '5s';

grant select on public.traffic_count_sites_live to viafrei_mcp;

create or replace view public.road_events_current as
 select id,
    feed_key,
    source_id,
    publication_id,
    version,
    publisher,
    event_type,
    road_number,
    referent_from,
    referent_to,
    distance_from_m,
    distance_to_m,
    geom,
    feed_ts,
    overall_start,
    overall_end,
    payload,
    first_seen_at,
    last_seen_at,
    closed_at,
    source_feed,
    source_publisher,
    source_run_id,
    provider_updated_at,
    created_at,
    updated_at,
    deleted_at,
    deleted_reason,
    deleted_run_id,
    confidentiality,
    closure_starts_at,
    closure_ends_at,
    valid_windows,
    suspended,
    entry_static
   from public.road_events_live e
  where e.closed_at is null
    and public.road_event_in_force_known(e.overall_start, e.overall_end, e.suspended, e.payload, e.valid_windows, now())
    and coalesce(e.confidentiality, 'noRestriction') = 'noRestriction';

commit;
