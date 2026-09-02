-- Per-member change-feed cursor for members-mode knowledge connectors (expand only).
--
-- A member whose connector can read a change feed (Google Drive `changes.list`) stores where that
-- feed resumes, so a run reads the feed instead of relisting the member's whole view of the
-- source. Both columns are nullable with no default, so this is metadata-only on PG11+ and the
-- currently deployed application, which never reads them, is unaffected.
ALTER TABLE "knowledge_connector_member" ADD COLUMN IF NOT EXISTS "change_cursor" text;--> statement-breakpoint
ALTER TABLE "knowledge_connector_member" ADD COLUMN IF NOT EXISTS "change_cursor_at" timestamp;
