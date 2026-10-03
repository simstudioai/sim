-- Installations upgrading past the prep release must finish its backfills first.
-- Check migration receipts instead of scanning the execution-log table during DDL.
-- Empty databases can apply the entire migration history in one pass.
DO $$
DECLARE
  size_backfilled boolean := false;
  cost_backfilled boolean := false;
BEGIN
  IF to_regclass('script_migrations') IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM script_migrations
      WHERE name = '0008_backfill_workspace_file_size_bytes'
    ) INTO size_backfilled;
    SELECT EXISTS (
      SELECT 1 FROM script_migrations
      WHERE name = '0009_backfill_wel_residual_cost_total'
    ) INTO cost_backfilled;
  END IF;

  IF NOT size_backfilled
    AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'workspace_files'::regclass AND attname = 'size' AND NOT attisdropped)
    AND EXISTS (SELECT 1 FROM workspace_files)
  THEN
    RAISE EXCEPTION 'Run the v0.8.38 db:migrate command to complete 0008_backfill_workspace_file_size_bytes before dropping workspace_files.size';
  END IF;
  IF NOT cost_backfilled
    AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'workflow_execution_logs'::regclass AND attname = 'cost' AND NOT attisdropped)
    AND EXISTS (SELECT 1 FROM workflow_execution_logs)
  THEN
    RAISE EXCEPTION 'Run the v0.8.38 db:migrate command to complete 0009_backfill_wel_residual_cost_total before dropping workflow_execution_logs.cost';
  END IF;
END;
$$;--> statement-breakpoint

-- The v0.8.38 application writes size_bytes; the legacy size bridge is no longer needed.
DROP TRIGGER IF EXISTS "workspace_files_sync_size_columns" ON "workspace_files";--> statement-breakpoint
DROP FUNCTION IF EXISTS "sync_workspace_file_size_columns"();--> statement-breakpoint

-- migration-safe: contract of #7134, #7774, and #7813 (v0.8.38): application and Better Auth SQL exclude departed_member_usage.
ALTER TABLE "organization" DROP COLUMN IF EXISTS "departed_member_usage";--> statement-breakpoint
-- migration-safe: contract of #7134 and #7774 (v0.8.38): user_stats reads and inserts exclude retired usage counters.
ALTER TABLE "user_stats" DROP COLUMN IF EXISTS "total_manual_executions";--> statement-breakpoint
-- migration-safe: contract of #7134 and #7774 (v0.8.38): user_stats reads and inserts exclude retired usage counters.
ALTER TABLE "user_stats" DROP COLUMN IF EXISTS "total_api_calls";--> statement-breakpoint
-- migration-safe: contract of #7134 and #7774 (v0.8.38): user_stats reads and inserts exclude retired usage counters.
ALTER TABLE "user_stats" DROP COLUMN IF EXISTS "total_webhook_triggers";--> statement-breakpoint
-- migration-safe: contract of #7134 and #7774 (v0.8.38): user_stats reads and inserts exclude retired usage counters.
ALTER TABLE "user_stats" DROP COLUMN IF EXISTS "total_scheduled_executions";--> statement-breakpoint
-- migration-safe: contract of #7134 and #7774 (v0.8.38): user_stats reads and inserts exclude retired usage counters.
ALTER TABLE "user_stats" DROP COLUMN IF EXISTS "total_chat_executions";--> statement-breakpoint
-- migration-safe: contract of #7134 and #7774 (v0.8.38): user_stats reads and inserts exclude retired usage counters.
ALTER TABLE "user_stats" DROP COLUMN IF EXISTS "total_mcp_executions";--> statement-breakpoint
-- migration-safe: contract of #7134 and #7774 (v0.8.38): user_stats reads and inserts exclude retired usage counters.
ALTER TABLE "user_stats" DROP COLUMN IF EXISTS "total_tokens_used";--> statement-breakpoint
-- migration-safe: contract of #7134 and #7774 (v0.8.38): user_stats reads and inserts exclude retired usage counters.
ALTER TABLE "user_stats" DROP COLUMN IF EXISTS "total_cost";--> statement-breakpoint
-- migration-safe: contract of #7134 and #7774 (v0.8.38): user_stats reads and inserts exclude retired usage counters.
ALTER TABLE "user_stats" DROP COLUMN IF EXISTS "current_period_cost";--> statement-breakpoint
-- migration-safe: contract of #7134 and #7774 (v0.8.38): user_stats reads and inserts exclude retired usage counters.
ALTER TABLE "user_stats" DROP COLUMN IF EXISTS "pro_period_cost_snapshot";--> statement-breakpoint
-- migration-safe: contract of #7134 and #7774 (v0.8.38): user_stats reads and inserts exclude retired usage counters.
ALTER TABLE "user_stats" DROP COLUMN IF EXISTS "pro_period_cost_snapshot_at";--> statement-breakpoint
-- migration-safe: contract of #7134 and #7774 (v0.8.38): user_stats reads and inserts exclude retired usage counters.
ALTER TABLE "user_stats" DROP COLUMN IF EXISTS "total_copilot_cost";--> statement-breakpoint
-- migration-safe: contract of #7134 and #7774 (v0.8.38): user_stats reads and inserts exclude retired usage counters.
ALTER TABLE "user_stats" DROP COLUMN IF EXISTS "current_period_copilot_cost";--> statement-breakpoint
-- migration-safe: contract of #7134 and #7774 (v0.8.38): user_stats reads and inserts exclude retired usage counters.
ALTER TABLE "user_stats" DROP COLUMN IF EXISTS "total_copilot_tokens";--> statement-breakpoint
-- migration-safe: contract of #7134 and #7774 (v0.8.38): user_stats reads and inserts exclude retired usage counters.
ALTER TABLE "user_stats" DROP COLUMN IF EXISTS "total_copilot_calls";--> statement-breakpoint
-- migration-safe: contract of #7134 and #7774 (v0.8.38): user_stats reads and inserts exclude retired usage counters.
ALTER TABLE "user_stats" DROP COLUMN IF EXISTS "total_mcp_copilot_calls";--> statement-breakpoint
-- migration-safe: contract of #7134 and #7774 (v0.8.38): user_stats reads and inserts exclude retired usage counters.
ALTER TABLE "user_stats" DROP COLUMN IF EXISTS "total_mcp_copilot_cost";--> statement-breakpoint
-- migration-safe: contract of #7134 and #7774 (v0.8.38): user_stats reads and inserts exclude retired usage counters.
ALTER TABLE "user_stats" DROP COLUMN IF EXISTS "current_period_mcp_copilot_cost";--> statement-breakpoint
-- migration-safe: contract of #7134 and #7774 (v0.8.38): user_stats reads and inserts exclude retired usage counters.
ALTER TABLE "user_stats" DROP COLUMN IF EXISTS "last_active";--> statement-breakpoint
-- migration-safe: contract of #7134 and #7774 (v0.8.38): log reads and inserts exclude cost; cost_total backfill completed before drop.
ALTER TABLE "workflow_execution_logs" DROP COLUMN IF EXISTS "cost";--> statement-breakpoint
-- migration-safe: contract of #7134 and #7774 (v0.8.38): all file reads and inserts use size_bytes; backfill completed before drop.
ALTER TABLE "workspace_files" DROP COLUMN IF EXISTS "size";
