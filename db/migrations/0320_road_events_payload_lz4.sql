-- road_events.payload compressed with lz4 instead of the default pglz.
--
-- The payload is the provider's whole message as jsonb, mostly TOASTed. In
-- production the column was switched by hand on 2026-11-19 and the existing
-- rows rewritten in batches: table plus TOAST went from 3 564 MB to 784 MB, and
-- the place read's road step from 69.1 to 56.8 ms per call (180 s windows).
--
-- This file sets the column's compression only. That is a catalogue change:
-- no row is rewritten, values written after it are compressed with lz4, and
-- values already stored keep their compression until they are rewritten. A
-- fresh database therefore needs nothing more. It takes a brief ACCESS
-- EXCLUSIVE lock on road_events, so it waits at most lock_timeout for one
-- and fails rather than queue the writers and readers behind it; the run is
-- then retried. Idempotent: setting the compression the column already has
-- changes nothing.
--
-- rollback:
--   alter table public.road_events alter column payload set compression default;
--   delete from schema_migrations where version = 320;

set local lock_timeout = '5s';
alter table public.road_events alter column payload set compression lz4;
