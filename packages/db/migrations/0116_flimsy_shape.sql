CREATE TYPE "public"."notification_delivery_status" AS ENUM('pending', 'in_progress', 'success', 'failed');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('webhook', 'email', 'slack');--> statement-breakpoint
CREATE TABLE "workspace_notification_delivery" (
	"id" text PRIMARY KEY NOT NULL,
	"subscription_id" text NOT NULL,
	"workflow_id" text NOT NULL,
	"execution_id" text NOT NULL,
	"status" "notification_delivery_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp,
	"next_attempt_at" timestamp,
	"response_status" integer,
	"response_body" text,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_notification_subscription" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"notification_type" "notification_type" NOT NULL,
	"workflow_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"all_workflows" boolean DEFAULT false NOT NULL,
	"level_filter" text[] DEFAULT ARRAY['info', 'error']::text[] NOT NULL,
	"trigger_filter" text[] DEFAULT ARRAY['api', 'webhook', 'schedule', 'manual', 'chat']::text[] NOT NULL,
	"include_final_output" boolean DEFAULT false NOT NULL,
	"include_trace_spans" boolean DEFAULT false NOT NULL,
	"include_rate_limits" boolean DEFAULT false NOT NULL,
	"include_usage_data" boolean DEFAULT false NOT NULL,
	"webhook_config" jsonb,
	"email_recipients" text[],
	"slack_config" jsonb,
	"alert_config" jsonb,
	"last_alert_at" timestamp,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "workspace_notification_subscription" (
	"id",
	"workspace_id",
	"notification_type",
	"workflow_ids",
	"all_workflows",
	"level_filter",
	"trigger_filter",
	"include_final_output",
	"include_trace_spans",
	"include_rate_limits",
	"include_usage_data",
	"webhook_config",
	"active",
	"created_by",
	"created_at",
	"updated_at"
)
SELECT
	wlw.id,
	w.workspace_id,
	'webhook'::"notification_type",
	ARRAY[wlw.workflow_id],
	false,
	wlw.level_filter,
	wlw.trigger_filter,
	wlw.include_final_output,
	wlw.include_trace_spans,
	wlw.include_rate_limits,
	wlw.include_usage_data,
	jsonb_build_object('url', wlw.url, 'secret', wlw.secret),
	wlw.active,
	w.user_id,
	wlw.created_at,
	wlw.updated_at
FROM workflow_log_webhook wlw
JOIN workflow w ON w.id = wlw.workflow_id
WHERE w.workspace_id IS NOT NULL;--> statement-breakpoint
DROP TABLE "workflow_log_webhook_delivery" CASCADE;--> statement-breakpoint
DROP TABLE "workflow_log_webhook" CASCADE;--> statement-breakpoint
ALTER TABLE "workspace_notification_delivery" ADD CONSTRAINT "workspace_notification_delivery_subscription_id_workspace_notification_subscription_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."workspace_notification_subscription"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_notification_delivery" ADD CONSTRAINT "workspace_notification_delivery_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_notification_subscription" ADD CONSTRAINT "workspace_notification_subscription_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_notification_subscription" ADD CONSTRAINT "workspace_notification_subscription_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workspace_notification_delivery_subscription_id_idx" ON "workspace_notification_delivery" USING btree ("subscription_id");--> statement-breakpoint
CREATE INDEX "workspace_notification_delivery_execution_id_idx" ON "workspace_notification_delivery" USING btree ("execution_id");--> statement-breakpoint
CREATE INDEX "workspace_notification_delivery_status_idx" ON "workspace_notification_delivery" USING btree ("status");--> statement-breakpoint
CREATE INDEX "workspace_notification_delivery_next_attempt_idx" ON "workspace_notification_delivery" USING btree ("next_attempt_at");--> statement-breakpoint
CREATE INDEX "workspace_notification_workspace_id_idx" ON "workspace_notification_subscription" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "workspace_notification_active_idx" ON "workspace_notification_subscription" USING btree ("active");--> statement-breakpoint
CREATE INDEX "workspace_notification_type_idx" ON "workspace_notification_subscription" USING btree ("notification_type");--> statement-breakpoint
ALTER TABLE "settings" DROP COLUMN "auto_pan";--> statement-breakpoint
ALTER TABLE "settings" DROP COLUMN "console_expanded_by_default";--> statement-breakpoint
ALTER TABLE "settings" DROP COLUMN "show_floating_controls";--> statement-breakpoint
DROP TYPE "public"."webhook_delivery_status";