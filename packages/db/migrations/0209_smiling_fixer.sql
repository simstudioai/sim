CREATE TABLE "table_row_executions" (
	"table_id" text NOT NULL,
	"row_id" text NOT NULL,
	"group_id" text NOT NULL,
	"status" text NOT NULL,
	"execution_id" text,
	"job_id" text,
	"workflow_id" text NOT NULL,
	"error" text,
	"running_block_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"block_errors" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"cancelled_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "table_row_executions_row_id_group_id_pk" PRIMARY KEY("row_id","group_id")
);
--> statement-breakpoint
CREATE TABLE "table_run_dispatches" (
	"id" text PRIMARY KEY NOT NULL,
	"table_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"request_id" text NOT NULL,
	"mode" text NOT NULL,
	"scope" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"cursor" integer DEFAULT 0 NOT NULL,
	"is_manual_run" boolean DEFAULT true NOT NULL,
	"requested_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"cancelled_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "table_row_executions" ADD CONSTRAINT "table_row_executions_table_id_user_table_definitions_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."user_table_definitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "table_row_executions" ADD CONSTRAINT "table_row_executions_row_id_user_table_rows_id_fk" FOREIGN KEY ("row_id") REFERENCES "public"."user_table_rows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "table_run_dispatches" ADD CONSTRAINT "table_run_dispatches_table_id_user_table_definitions_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."user_table_definitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "table_run_dispatches" ADD CONSTRAINT "table_run_dispatches_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "table_row_executions_table_status_idx" ON "table_row_executions" USING btree ("table_id","status") WHERE "table_row_executions"."status" IN ('queued', 'running', 'pending');--> statement-breakpoint
CREATE INDEX "table_row_executions_execution_id_idx" ON "table_row_executions" USING btree ("execution_id") WHERE "table_row_executions"."execution_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "table_row_executions_table_group_idx" ON "table_row_executions" USING btree ("table_id","group_id");--> statement-breakpoint
CREATE INDEX "table_run_dispatches_active_idx" ON "table_run_dispatches" USING btree ("table_id","status");--> statement-breakpoint
CREATE INDEX "table_run_dispatches_watchdog_idx" ON "table_run_dispatches" USING btree ("status","requested_at");--> statement-breakpoint
ALTER TABLE "user_table_rows" DROP COLUMN "executions";