-- api_reader reads the row versions of the feed catalogue and of the
-- registered sources, never their content.
--
-- viafrei-api ends a cached answer when the source register it was read
-- under changes. The register fingerprint is an aggregate over every register
-- row (about 200 ms on production, 2026-11-25), so the API reads it again
-- only when a row of the tables it is derived from was written: it compares a
-- digest of their row versions (ctid and xmin) on each versions read, about
-- once a second, and reads its register snapshot again only then too. The
-- feed catalogue and the registered sources (ingestor.sources, behind
-- registered_sources) are two of them, read so far only through the
-- owner-rights contract_sources view; this grants api_reader their two
-- system columns ctid and xmin, by name, and no column of their own: what a
-- feed or a source is, its offer and its licence stay readable only through
-- the view. USAGE on the schema ingestor lets api_reader name the table; it
-- reads nothing else there.
--
-- The other register tables (source_register, source_register_notes,
-- licence_texts, message_coverage_sources, driving_rule_topics,
-- driving_rule_facts) api_reader already reads (0336).
--
-- A GRANT takes no lock on the relation; re-applied, each is a no-op.
--
-- rollback:
--   revoke select (ctid, xmin) on ingestor.sources from api_reader;
--   revoke usage on schema ingestor from api_reader;
--   revoke select (ctid, xmin) on public.feed_catalog from api_reader;
--   delete from schema_migrations where version = 348;

set local lock_timeout = '5s';

grant select (ctid, xmin) on public.feed_catalog to api_reader;
grant usage on schema ingestor to api_reader;
grant select (ctid, xmin) on ingestor.sources to api_reader;
