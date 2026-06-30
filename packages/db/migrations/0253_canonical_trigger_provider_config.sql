-- migration-safe: data-only backfill. Expand-phase companion to the canonical-key collapse in
-- buildProviderConfig + the canonical-first poller reads. Populates each polling trigger's canonical
-- providerConfig key from the value the CURRENT poller already reads (basic-first), so NO deployed
-- trigger changes which resource it polls. Per provider the basic-first effective value is:
--   google-drive   folderId       <- folderId, else manualFolderId        (canonical key == basic key)
--   google-sheets  spreadsheetId  <- spreadsheetId, else manualSpreadsheetId
--   google-sheets  sheetName      <- sheetName, else manualSheetName
--   google-calendar calendarId    <- calendarId, else manualCalendarId
--   table          tableId        <- tableSelector, else manualTableId     (canonical key is distinct)
-- For the Google triggers the canonical key IS the basic subblock key, so a row whose canonical key
-- is already set is left untouched (it already equals the basic-first read); only rows where it is
-- absent are filled from the advanced key. The table canonical key (tableId) was never written
-- before, so it is filled from tableSelector/manualTableId.
--
-- Idempotent: every statement only writes where the canonical key is still empty, so a replay (a
-- failed migration re-runs unjournaled files from the top) is a no-op. Bounded: each UPDATE is scoped
-- to one provider and the empty-canonical predicate, touching only un-backfilled rows. Safe under
-- concurrent writes: the still-live previous app version never writes these canonical keys (it writes
-- the raw subblock keys), and any row it inserts after this runs is handled by the pollers'
-- transitional basic-first fallback until its next redeploy. providerConfig is a `json` column, so it
-- is cast to jsonb for the `||` merge and back to json for storage.
UPDATE "webhook"
SET "provider_config" = (
  COALESCE(("provider_config")::jsonb, '{}'::jsonb)
  || jsonb_build_object('folderId', ("provider_config")::jsonb ->> 'manualFolderId')
)::json
WHERE "provider" = 'google-drive'
  AND NULLIF(("provider_config")::jsonb ->> 'folderId', '') IS NULL
  AND NULLIF(("provider_config")::jsonb ->> 'manualFolderId', '') IS NOT NULL;
--> statement-breakpoint
UPDATE "webhook"
SET "provider_config" = (
  COALESCE(("provider_config")::jsonb, '{}'::jsonb)
  || jsonb_build_object('spreadsheetId', ("provider_config")::jsonb ->> 'manualSpreadsheetId')
)::json
WHERE "provider" = 'google-sheets'
  AND NULLIF(("provider_config")::jsonb ->> 'spreadsheetId', '') IS NULL
  AND NULLIF(("provider_config")::jsonb ->> 'manualSpreadsheetId', '') IS NOT NULL;
--> statement-breakpoint
UPDATE "webhook"
SET "provider_config" = (
  COALESCE(("provider_config")::jsonb, '{}'::jsonb)
  || jsonb_build_object('sheetName', ("provider_config")::jsonb ->> 'manualSheetName')
)::json
WHERE "provider" = 'google-sheets'
  AND NULLIF(("provider_config")::jsonb ->> 'sheetName', '') IS NULL
  AND NULLIF(("provider_config")::jsonb ->> 'manualSheetName', '') IS NOT NULL;
--> statement-breakpoint
UPDATE "webhook"
SET "provider_config" = (
  COALESCE(("provider_config")::jsonb, '{}'::jsonb)
  || jsonb_build_object('calendarId', ("provider_config")::jsonb ->> 'manualCalendarId')
)::json
WHERE "provider" = 'google-calendar'
  AND NULLIF(("provider_config")::jsonb ->> 'calendarId', '') IS NULL
  AND NULLIF(("provider_config")::jsonb ->> 'manualCalendarId', '') IS NOT NULL;
--> statement-breakpoint
UPDATE "webhook"
SET "provider_config" = (
  COALESCE(("provider_config")::jsonb, '{}'::jsonb)
  || jsonb_build_object('tableId', COALESCE(
       NULLIF(("provider_config")::jsonb ->> 'tableSelector', ''),
       NULLIF(("provider_config")::jsonb ->> 'manualTableId', '')
     ))
)::json
WHERE "provider" = 'table'
  AND NULLIF(("provider_config")::jsonb ->> 'tableId', '') IS NULL
  AND COALESCE(
        NULLIF(("provider_config")::jsonb ->> 'tableSelector', ''),
        NULLIF(("provider_config")::jsonb ->> 'manualTableId', '')
      ) IS NOT NULL;
