-- The publishers' own warnings about their live car-park figures, as
-- condition notes of their register rows.
--
-- Two publishers say of their free-space figures that they may be wrong:
-- Hamburg's Parkhäuser dataset „Diese Echtzeitdaten sind ungeprüft.“, and
-- Dortmund's „Bei Störungen können die tatsächlichen Belegungszahlen
-- abweichen! …“. Today's MCP server shows each sentence with every figure of
-- theirs it shows (its feed registry's occupancyCaveat, 2026-10-10); the API
-- shows a register row's condition notes beside the rows of the families that
-- name it (0309, 0312). Production, read only, 2026-11-25: hh_parkhaeuser
-- names hamburg_parkhaeuser, park_dortmund_portal names dortmund_parkhauser,
-- and neither register row has a note. The texts are the MCP server's,
-- verbatim, in both languages.
--
-- On conflict nothing is written: a note already there is kept.
--
-- rollback:
--   delete from public.source_register_notes
--    where source_id in ('hamburg_parkhaeuser', 'dortmund_parkhauser') and note_kind = 'condition';
--   delete from schema_migrations where version = 349;

set local lock_timeout = '5s';

insert into public.source_register_notes (source_id, note_kind, lang, body) values
  ('hamburg_parkhaeuser', 'condition', 'de', 'Freie Plätze der Hamburger Parkhäuser: „Diese Echtzeitdaten sind ungeprüft.“ (Freie und Hansestadt Hamburg)'),
  ('hamburg_parkhaeuser', 'condition', 'en', 'Free spaces of the Hamburg car parks: the publisher states „Diese Echtzeitdaten sind ungeprüft.“ — these real-time figures are unverified.'),
  ('dortmund_parkhauser', 'condition', 'de', 'Freie Plätze Dortmund: „Bei Störungen können die tatsächlichen Belegungszahlen abweichen! Bitte beachten Sie daher den aktuellen Zeitstempel der Daten.“ (Stadt Dortmund)'),
  ('dortmund_parkhauser', 'condition', 'en', 'Free spaces in Dortmund: the publisher states „Bei Störungen können die tatsächlichen Belegungszahlen abweichen!“ — during a fault of the guidance system the real figures may differ; mind the time of each reading.')
on conflict (source_id, note_kind, lang) do nothing;
