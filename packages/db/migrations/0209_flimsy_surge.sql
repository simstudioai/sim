CREATE TABLE "table_run_dispatches" (
	"id" text PRIMARY KEY NOT NULL,
	"table_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"request_id" text NOT NULL,
	"mode" text NOT NULL,
	"scope" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"cursor" integer DEFAULT 0 NOT NULL,
	"requested_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"cancelled_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "table_run_dispatches" ADD CONSTRAINT "table_run_dispatches_table_id_user_table_definitions_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."user_table_definitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "table_run_dispatches" ADD CONSTRAINT "table_run_dispatches_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "table_run_dispatches_active_idx" ON "table_run_dispatches" USING btree ("table_id","status");--> statement-breakpoint
CREATE INDEX "table_run_dispatches_watchdog_idx" ON "table_run_dispatches" USING btree ("status","requested_at");