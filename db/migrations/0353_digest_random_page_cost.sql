-- viafrei_digest plans with random_page_cost 1.1 instead of the server's
-- value, which costs the digest's index reads lower against sequential scans.
-- Production was given this setting by hand on 2026-11-21 (owner-approved),
-- as a role setting in every database (ALTER ROLE ... SET, no IN DATABASE): read
-- 2026-11-25, pg_db_role_setting holds viafrei_digest, setdatabase 0,
-- {random_page_cost=1.1}. This file writes that same row, so the migrate run
-- there leaves it as it is.
--
-- Not in db/roles/settings.sql: that file holds the IN DATABASE settings, the
-- ones a database copied from a template loses. A setting in every database is
-- held once for the server and no copy loses it. An IN DATABASE value of the
-- same name would win over this one; there is none.
--
-- The role is the baseline's; the guard makes the file a no-op on a server
-- without it instead of an error.
--
-- rollback:
--   alter role viafrei_digest reset random_page_cost;
--   delete from schema_migrations where version = 353;

set local lock_timeout = '5s';

DO $$ BEGIN IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'viafrei_digest') THEN EXECUTE 'ALTER ROLE viafrei_digest SET random_page_cost TO ''1.1'''; END IF; END $$;
