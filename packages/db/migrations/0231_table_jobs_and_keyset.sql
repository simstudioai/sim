CREATE TABLE "table_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"table_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"payload" jsonb,
	"rows_processed" integer DEFAULT 0 NOT NULL,
	"error" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "table_jobs" ADD CONSTRAINT "table_jobs_table_id_user_table_definitions_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."user_table_definitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "table_jobs" ADD CONSTRAINT "table_jobs_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "table_jobs_one_active_per_table" ON "table_jobs" USING btree ("table_id") WHERE "table_jobs"."status" = 'running' AND "table_jobs"."type" <> 'export';--> statement-breakpoint
CREATE INDEX "table_jobs_watchdog_idx" ON "table_jobs" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "table_jobs_table_started_idx" ON "table_jobs" USING btree ("table_id","started_at");--> statement-breakpoint
CREATE INDEX "user_table_rows_table_id_id_idx" ON "user_table_rows" USING btree ("table_id","id");--> statement-breakpoint
-- Migrate any existing import-job state off the definition columns into table_jobs before dropping
-- them. Each definition has at most one import_status, so this yields at most one job per table and
-- never violates the partial-unique active-job index. The old in-flight literal 'importing' maps to
-- 'running'.
INSERT INTO "table_jobs" ("id", "table_id", "workspace_id", "type", "status", "rows_processed", "error", "started_at", "updated_at", "completed_at")
SELECT
	COALESCE("import_id", 'job_' || "id"),
	"id",
	"workspace_id",
	'import',
	CASE WHEN "import_status" = 'importing' THEN 'running' ELSE "import_status" END,
	COALESCE("import_rows_processed", 0),
	"import_error",
	COALESCE("import_started_at", now()),
	now(),
	CASE WHEN "import_status" IN ('ready', 'failed', 'canceled') THEN now() ELSE NULL END
FROM "user_table_definitions"
WHERE "import_status" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "user_table_definitions" DROP COLUMN "import_status";--> statement-breakpoint
ALTER TABLE "user_table_definitions" DROP COLUMN "import_id";--> statement-breakpoint
ALTER TABLE "user_table_definitions" DROP COLUMN "import_error";--> statement-breakpoint
ALTER TABLE "user_table_definitions" DROP COLUMN "import_rows_processed";--> statement-breakpoint
ALTER TABLE "user_table_definitions" DROP COLUMN "import_started_at";--> statement-breakpoint
-- All tenants' rows share this one relation, so the default autovacuum trigger (~20% of the whole
-- relation dead) lets a single tenant's mass delete leave their reads degraded for days. Vacuum at
-- ~2% churn instead; runs are frequent but cheap (the visibility map skips untouched pages).
ALTER TABLE "user_table_rows" SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.01);--> statement-breakpoint
-- Tenant-scoped containment index: a plain GIN on data matches @> candidates across every
-- tenant sharing this relation (measured 1.07M candidates fetched for a 33k-row match). btree_gin
-- lets table_id lead the GIN so the intersection happens inside the index, and jsonb_path_ops
-- indexes whole key->value paths (single lookup, smaller index). Every @> query carries table_id,
-- so the old cross-tenant index is strictly redundant.
CREATE EXTENSION IF NOT EXISTS btree_gin;--> statement-breakpoint
DROP INDEX "user_table_rows_data_gin_idx";--> statement-breakpoint
CREATE INDEX "user_table_rows_tenant_data_gin_idx" ON "user_table_rows" USING gin ("table_id","data" jsonb_path_ops);