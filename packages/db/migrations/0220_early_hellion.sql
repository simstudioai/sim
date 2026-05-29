ALTER TABLE "workflow_execution_logs" ADD COLUMN IF NOT EXISTS "cost_total" numeric;--> statement-breakpoint
ALTER TABLE "workflow_execution_logs" ADD COLUMN IF NOT EXISTS "models_used" text[];--> statement-breakpoint
COMMIT;--> statement-breakpoint
ALTER TYPE "public"."usage_log_category" ADD VALUE IF NOT EXISTS 'tool';--> statement-breakpoint
CREATE OR REPLACE PROCEDURE backfill_wel_cost_total_0220() LANGUAGE plpgsql AS $$
DECLARE
  updated integer;
BEGIN
  LOOP
    WITH candidates AS (
      SELECT id FROM workflow_execution_logs
      WHERE cost_total IS NULL
        AND cost ? 'total'
        AND (cost->>'total') ~ '^-?[0-9]+(\.[0-9]+)?$'
      LIMIT 5000
    )
    UPDATE workflow_execution_logs wel
    SET cost_total = NULLIF(wel.cost->>'total', '')::numeric,
        models_used = CASE
          WHEN jsonb_typeof(wel.cost->'models') = 'object'
          THEN ARRAY(SELECT jsonb_object_keys(wel.cost->'models'))
          ELSE wel.models_used
        END
    FROM candidates
    WHERE wel.id = candidates.id;
    GET DIAGNOSTICS updated = ROW_COUNT;
    EXIT WHEN updated = 0;
    COMMIT;
  END LOOP;
END;
$$;--> statement-breakpoint
CALL backfill_wel_cost_total_0220();--> statement-breakpoint
DROP PROCEDURE backfill_wel_cost_total_0220();--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "usage_log_execution_id_idx" ON "usage_log" USING btree ("execution_id");--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "workflow_execution_logs_workspace_cost_total_idx" ON "workflow_execution_logs" USING btree ("workspace_id","cost_total");--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "workflow_execution_logs_models_used_idx" ON "workflow_execution_logs" USING gin ("models_used");
