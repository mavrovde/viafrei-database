-- The read contract of viafrei-api (#29): schema contract, version 0.3, and the
-- API's read-only role api_reader. Until this release the API built both
-- itself, from its own DDL, beside the platform's schema; this file is that
-- DDL's successor, and the API runs no DDL of its own.
--
-- Every relation is a VIEW, never a table: the contract is a read model the
-- platform publishes, and its rows come from the platform's own tables. The
-- columns, their order and their types are those of the API's stub of contract
-- 0.2 (db/contract 0001, 0003 and 0004 there), so every query the API compiles
-- against that stub reads these views unchanged. test/api-schemas.db.test.ts
-- holds the shape to the stub's, column for column.
--
-- contract_info answers the contract version, 0.3 (0.2's columns, here, plus
-- the licence envelope 0312 appends to each view), which the API's readiness
-- check reads. Every other view publishes NO ROW yet (`where false`): which
-- platform rows may be published through the API, and under which source,
-- licence and confidentiality filter, is decided per relation, and each one is
-- a later migration that replaces its view (create or replace view keeps the
-- columns). An empty relation is an honest "no data" to the API; a mapping
-- made in haste could publish a row its licence keeps back.
--
-- What the stub had and a view cannot have, on purpose: constraints, foreign
-- keys, indexes, partitions and default partitions (the views have no storage;
-- the platform's tables carry those), and contract_info's version check (the
-- view states the one version). The stub's `revoke create on schema public
-- from public` is not repeated: PUBLIC holds no CREATE there in this schema.
--
-- api_reader may read the schema contract and nothing else: USAGE on the
-- schema, SELECT on every view, no other grant. Its settings are made IN
-- DATABASE, like every service role's (db/roles/settings.sql), not for every
-- database as the stub made them. Its password comes from the roles step
-- (db/roles/api-reader-role-password.sql), never from this file.
--
-- rollback: drop schema contract cascade; then, in every database of the
-- cluster that no longer needs it, `reassign owned by api_reader to <owner>;
-- drop owned by api_reader;` and once in the cluster `drop role api_reader;`;
--   delete from schema_migrations where version = 307;

-- The lint reads ALTER ROLE as a strong lock; it takes none on a table, but
-- the bound costs nothing. CREATE ROLE itself takes a cluster-wide lock on
-- pg_authid: when two databases of one cluster migrate at once, the second
-- fails loudly on a duplicate key of pg_authid, and a re-run passes.
set local lock_timeout = '5s';

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'api_reader') THEN
    CREATE ROLE api_reader WITH NOSUPERUSER NOINHERIT NOCREATEROLE NOCREATEDB LOGIN NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 16;
  ELSIF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'api_reader' AND rolsuper = false AND rolinherit = false AND rolcreaterole = false AND rolcreatedb = false AND rolcanlogin = true AND rolreplication = false AND rolbypassrls = false AND rolconnlimit = 16 AND NOT EXISTS (SELECT FROM pg_catalog.pg_auth_members WHERE member = 'api_reader'::regrole)) THEN
    RAISE EXCEPTION 'role api_reader exists with other attributes or a membership this migration does not give it; align it first (roles are cluster-wide and never altered here)';
  END IF;
END $$;

-- The connection limit equals the largest pool the API's configuration
-- accepts, so a pool at its maximum is never refused a connection. Every
-- session is read-only, and a statement timeout stops a runaway query even
-- when a client-side cancel is lost.
DO $$ BEGIN EXECUTE format('ALTER ROLE api_reader IN DATABASE %I SET default_transaction_read_only TO ''on''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE api_reader IN DATABASE %I SET statement_timeout TO ''2s''', current_database()); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE api_reader IN DATABASE %I SET idle_in_transaction_session_timeout TO ''5s''', current_database()); END $$;

create schema contract;
comment on schema contract is 'The read contract of viafrei-api, version 0.3: views only, read by the role api_reader alone. contract_info states the version; every other view publishes no row until its mapping onto the platform''s tables is reviewed and migrated.';

create view contract.contract_info as
select '0.3'::text                              as contract_version,
       '2026-11-16 00:00:00+00'::timestamptz    as published_at;
comment on view contract.contract_info is 'The read-contract version this database publishes, and since when. One row; the API''s readiness reads the newest by published_at.';

create view contract.publisher as
select null::text   as publisher_id,
       null::text   as display_name,
       null::text   as website
 where false;

create view contract.licence as
select null::text      as licence_code,
       null::text      as licence_name,
       null::text      as licence_url,
       null::text      as licence_category,
       null::boolean   as share_alike,
       null::boolean   as attribution_required
 where false;

create view contract.source as
select null::text      as source_ref,
       null::text      as domain,
       null::text      as publisher_id,
       null::text      as licence_code,
       null::text      as attribution_text,
       null::text      as changes_statement,
       null::text      as terms_url,
       null::text      as share_alike_offer_url,
       null::boolean   as acceptance_required,
       null::text[]    as use_classes,
       null::integer   as freshness_target_s,
       null::integer   as stale_after_s,
       null::date      as review_signed_on,
       null::date      as register_version
 where false;

create view contract.source_note as
select null::text   as source_ref,
       null::text   as note_kind,
       null::text   as lang,
       null::text   as body
 where false;

create view contract.source_freshness as
select null::text                       as source_ref,
       null::timestamp with time zone   as data_as_of,
       null::text                       as freshness_version,
       null::timestamp with time zone   as confirmed_at,
       null::integer                    as confirm_interval_s,
       null::boolean                    as updates_paused
 where false;

create view contract.admin_region as
select null::text                          as region_code,
       null::text                          as region_level,
       null::text                          as name,
       null::text                          as parent_code,
       null::geometry(MultiPolygon,4326)   as boundary
 where false;

create view contract.place as
select null::text                       as place_id,
       null::text                       as place_kind,
       null::text                       as name,
       null::geometry(Point,4326)       as location,
       null::text                       as region_code,
       null::text                       as official_key,
       null::integer                    as prominence,
       null::text                       as source_ref,
       null::text                       as origin_key,
       null::timestamp with time zone   as published_at,
       null::timestamp with time zone   as recorded_at,
       null::timestamp with time zone   as changed_at,
       null::timestamp with time zone   as withdrawn_at
 where false;

create view contract.place_alias as
select null::text   as place_id,
       null::text   as label,
       null::text   as lang,
       null::text   as name_kind,
       null::text   as search_fold
 where false;

create view contract.road as
select null::text                             as road_ref,
       null::text                             as road_class,
       null::text                             as name,
       null::numeric(6,1)                     as length_km,
       null::geometry(MultiLineString,4326)   as geometry,
       null::text[]                           as states
 where false;

create view contract.junction as
select null::text                   as junction_id,
       null::text                   as road_ref,
       null::text                   as number,
       null::text                   as name,
       null::text                   as junction_kind,
       null::numeric(6,1)           as chainage_km,
       null::geometry(Point,4326)   as location,
       null::text                   as state_code
 where false;

create view contract.traffic_event as
select null::text                       as event_id,
       null::text                       as event_kind,
       null::text                       as severity,
       null::text                       as road_ref,
       null::text                       as road_class,
       null::text                       as direction,
       null::text                       as direction_label,
       null::geometry(Point,4326)       as location,
       null::timestamp with time zone   as valid_from,
       null::timestamp with time zone   as valid_to,
       null::integer                    as lanes_closed,
       null::integer                    as lanes_total,
       null::integer                    as delay_min,
       null::integer                    as affected_length_m,
       null::text                       as headline,
       null::text                       as description,
       null::text                       as text_lang,
       null::text                       as source_ref,
       null::text                       as origin_key,
       null::timestamp with time zone   as published_at,
       null::timestamp with time zone   as recorded_at,
       null::timestamp with time zone   as changed_at,
       null::timestamp with time zone   as withdrawn_at,
       null::text                       as record_class,
       null::text                       as subtitle,
       null::text                       as place_text,
       null::boolean                    as is_blocked,
       null::text                       as traffic_type,
       null::integer                    as delay_s
 where false;

create view contract.traffic_event_observation as
select null::text                       as event_id,
       null::timestamp with time zone   as observed_at,
       null::integer                    as version_no
 where false;

create view contract.fuel_station as
select null::text                       as station_id,
       null::text                       as name,
       null::text                       as brand,
       null::text                       as region_code,
       null::geometry(Point,4326)       as location,
       null::text                       as open_state,
       null::timestamp with time zone   as open_state_at,
       null::text                       as source_ref,
       null::text                       as origin_key,
       null::timestamp with time zone   as recorded_at,
       null::timestamp with time zone   as changed_at,
       null::timestamp with time zone   as withdrawn_at
 where false;

create view contract.fuel_product as
select null::text   as product_code,
       null::text   as label,
       null::text   as price_unit
 where false;

create view contract.fuel_price_observation as
select null::text                       as station_id,
       null::text                       as product_code,
       null::timestamp with time zone   as observed_at,
       null::numeric(6,3)               as price,
       null::character(3)               as currency,
       null::text                       as source_ref
 where false;

create view contract.charging_site as
select null::text                       as site_id,
       null::text                       as name,
       null::text                       as operator_name,
       null::text                       as access,
       null::geometry(Point,4326)       as location,
       null::text                       as source_ref,
       null::text                       as origin_key,
       null::timestamp with time zone   as recorded_at,
       null::timestamp with time zone   as changed_at,
       null::timestamp with time zone   as withdrawn_at
 where false;

create view contract.charge_point as
select null::text           as point_id,
       null::text           as site_id,
       null::text           as evse_code,
       null::text           as current_kind,
       null::numeric(7,2)   as power_max_kw
 where false;

create view contract.charge_point_state_observation as
select null::text                       as point_id,
       null::timestamp with time zone   as observed_at,
       null::text                       as availability,
       null::text                       as source_ref
 where false;

create view contract.parking_facility as
select null::text                       as facility_id,
       null::text                       as name,
       null::text                       as parking_kind,
       null::text                       as operator_name,
       null::text                       as road_ref,
       null::text                       as direction,
       null::geometry(Point,4326)       as location,
       null::boolean                    as acceptance_required,
       null::text                       as source_ref,
       null::text                       as origin_key,
       null::timestamp with time zone   as recorded_at,
       null::timestamp with time zone   as changed_at,
       null::timestamp with time zone   as withdrawn_at
 where false;

create view contract.occupancy_observation as
select null::text                       as facility_id,
       null::timestamp with time zone   as observed_at,
       null::integer                    as free_spaces,
       null::integer                    as total_spaces,
       null::text                       as occupancy_status,
       null::text                       as source_ref
 where false;

create view contract.stop_place as
select null::text                       as stop_place_id,
       null::text                       as name,
       null::geometry(Point,4326)       as location,
       null::text                       as national_stop_code,
       null::text                       as region_code,
       null::text[]                     as modes,
       null::text                       as search_fold,
       null::text                       as source_ref,
       null::text                       as origin_key,
       null::timestamp with time zone   as recorded_at,
       null::timestamp with time zone   as changed_at,
       null::timestamp with time zone   as withdrawn_at
 where false;

create view contract.stop_point as
select null::text   as stop_point_id,
       null::text   as stop_place_id,
       null::text   as platform_label
 where false;

create view contract.transit_line as
select null::text   as line_id,
       null::text   as line_name,
       null::text   as transport_mode
 where false;

create view contract.journey as
select null::text      as journey_id,
       null::text      as line_id,
       null::date      as service_date,
       null::text      as destination_label,
       null::boolean   as extra
 where false;

create view contract.scheduled_call as
select null::text                       as journey_id,
       null::integer                    as call_order,
       null::text                       as stop_point_id,
       null::timestamp with time zone   as planned_arrival_at,
       null::timestamp with time zone   as planned_departure_at,
       null::text                       as planned_platform
 where false;

create view contract.call_observation as
select null::text                       as journey_id,
       null::integer                    as call_order,
       null::timestamp with time zone   as observed_at,
       null::timestamp with time zone   as expected_arrival_at,
       null::timestamp with time zone   as expected_departure_at,
       null::text                       as call_status,
       null::text                       as source_ref
 where false;

create view contract.station_facility as
select null::text                       as facility_id,
       null::text                       as stop_place_id,
       null::text                       as facility_kind,
       null::text                       as position_text,
       null::text                       as facility_status,
       null::timestamp with time zone   as status_observed_at,
       null::text                       as source_ref
 where false;

create view contract.weather_warning as
select null::text                       as warning_id,
       null::text                       as hazard,
       null::integer                    as warning_level,
       null::text                       as level_label,
       null::text                       as message_status,
       null::text                       as issuer_name,
       null::text                       as headline,
       null::text                       as text_lang,
       null::timestamp with time zone   as valid_from,
       null::timestamp with time zone   as valid_to,
       null::timestamp with time zone   as published_at,
       null::text                       as region_code,
       null::text                       as source_ref,
       null::timestamp with time zone   as recorded_at,
       null::timestamp with time zone   as withdrawn_at
 where false;

create view contract.rule_topic as
select null::text   as topic_code,
       null::text   as title,
       null::date   as reviewed_on
 where false;

create view contract.rule_statement as
select null::text      as statement_id,
       null::text      as topic_code,
       null::integer   as position,
       null::text      as body,
       null::text      as legal_basis
 where false;

create view contract.message_coverage as
select null::text      as state_code,
       null::text      as source_ref,
       null::text      as coverage_role,
       null::boolean   as current_only
 where false;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT c.relname FROM pg_class c WHERE c.relnamespace = 'contract'::regnamespace AND c.relkind = 'v' AND c.relname <> 'contract_info' LOOP
    EXECUTE format('COMMENT ON VIEW contract.%I IS %L', r.relname,
      'Contract 0.3 shape. Publishes no row yet: its mapping onto the platform''s tables is a later migration.');
  END LOOP;
END $$;

grant usage on schema contract to api_reader;
grant select on all tables in schema contract to api_reader;
