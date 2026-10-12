-- Contracts expand/contract migrations whose readers and writers were removed in releases that have
-- already shipped. copilot_chats.plan_artifact, copilot_messages.parent_message_id/tokens_in/tokens_out,
-- and settings.show_training_controls/copilot_enabled_models are only un-declared here: v0.9.18 still
-- names them in its generated inserts, so their DROP COLUMN waits for the next release
-- (contract-pending markers in schema.ts). embedding_keyword_tin is dropped by script migration
-- 0031, which runs after 0030 removes the triggers that still write it on skipped-release upgrades.
-- Each drop autocommits: a table drop takes ACCESS EXCLUSIVE on every FK parent (user,
-- workspace, embedding, ...), so a busy parent fails fast for migrate.ts to retry rather than queue
-- traffic behind it, and no statement holds an earlier parent's lock while it waits.
COMMIT;--> statement-breakpoint
SET lock_timeout = '100ms';--> statement-breakpoint
-- The lock spans the backfill and SET NOT NULL so a fork copying a legacy null row cannot land between them.
BEGIN;--> statement-breakpoint
SET LOCAL lock_timeout = '100ms';--> statement-breakpoint
SET LOCAL statement_timeout = '5s';--> statement-breakpoint
LOCK TABLE "chat" IN ACCESS EXCLUSIVE MODE NOWAIT;--> statement-breakpoint
ALTER TABLE "chat" ALTER COLUMN "include_tool_calls" SET DEFAULT false;--> statement-breakpoint
UPDATE "chat" SET "include_tool_calls" = false WHERE "include_tool_calls" IS NULL;--> statement-breakpoint
-- migration-safe: every released writer sends a boolean or omits the column (now DEFAULT false); the UPDATE above normalized legacy nulls under the same lock and no reader distinguishes null from false.
ALTER TABLE "chat" ALTER COLUMN "include_tool_calls" SET NOT NULL;--> statement-breakpoint
COMMIT;--> statement-breakpoint
-- migration-safe: contract of #8528 (shipped in v0.9.10): live Search no longer reads or writes indexed Search activity.
DROP TABLE IF EXISTS "organization_search_invocation";--> statement-breakpoint
-- migration-safe: no released Sim or worker version reads or writes callback subscriptions; tasks read canonical execution status.
DROP TABLE IF EXISTS "copilot_task_subscriptions";--> statement-breakpoint
-- migration-safe: contract of #4090 (shipped in v0.6.40): workflow read hashes are no longer read or written.
DROP TABLE IF EXISTS "copilot_workflow_read_hashes";--> statement-breakpoint
-- migration-safe: contract of #4923 (shipped in v0.7.0): mothership settings are no longer read or written.
DROP TABLE IF EXISTS "mothership_settings";--> statement-breakpoint
-- migration-safe: contract of #5388 (shipped in v0.7.22): the Academy code that issued certificates was removed.
DROP TABLE IF EXISTS "academy_certificate";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."academy_cert_status";--> statement-breakpoint
SET lock_timeout = 0;--> statement-breakpoint
-- migration-safe: contract of #8330 (shipped in v0.9.4): processing recovery pages per connector on doc_connector_processing_recovery_idx and no deployed query uses this index.
DROP INDEX CONCURRENTLY IF EXISTS "doc_processing_recovery_idx";--> statement-breakpoint
SET lock_timeout = '5s';
