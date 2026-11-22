-- weather_warnings_area_live_de: the digest's German-only twin of
-- weather_warnings_area_live. The same rows, and the same columns in the same
-- order, without the four en_* ones, so a German read (the live map's weather
-- overlay) no longer calls the SECURITY DEFINER weather_warning_english() once
-- per live warning. area_live keeps its columns and its English for the
-- readers that show it.
--
-- Production was given this view by hand on 2026-11-22; create or replace
-- adopts it there (the same columns, so nothing changes) and creates it
-- everywhere else.
--
-- rollback:
--   drop view public.weather_warnings_area_live_de;
--   delete from schema_migrations where version = 328;

set local lock_timeout = '5s';

create or replace view public.weather_warnings_area_live_de as
  select w.identifier, w.warncell_id, w.event, w.level, w.level_source, w.headline, w.valid_from, w.valid_to,
         w.area, w.source_id, w.closed_at, w.description, w.instruction
    from public.weather_warnings_live w;

comment on view public.weather_warnings_area_live_de is 'weather_warnings_area_live without its English: the same rows and the same columns in the same order but en_headline, en_description, en_instruction and en_content_sha256, so a German read does not call weather_warning_english() per row. Migration 0328.';

grant select on public.weather_warnings_area_live_de to viafrei_digest;
