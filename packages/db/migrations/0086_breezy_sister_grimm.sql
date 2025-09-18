CREATE TYPE "public"."webhook_delivery_status" AS ENUM('pending', 'in_progress', 'success', 'failed');--> statement-breakpoint
CREATE TABLE "workflow_log_webhook" (
	"id" text PRIMARY KEY NOT NULL,
	"workflow_id" text NOT NULL,
	"url" text NOT NULL,
	"secret" text,
	"include_final_output" boolean DEFAULT false NOT NULL,
	"include_trace_spans" boolean DEFAULT false NOT NULL,
	"include_rate_limits" boolean DEFAULT false NOT NULL,
	"include_usage_data" boolean DEFAULT false NOT NULL,
	"level_filter" text[] DEFAULT ARRAY['info', 'error']::text[] NOT NULL,
	"trigger_filter" text[] DEFAULT ARRAY['api', 'webhook', 'schedule', 'manual', 'chat']::text[] NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_log_webhook_delivery" (
	"id" text PRIMARY KEY NOT NULL,
	"subscription_id" text NOT NULL,
	"workflow_id" text NOT NULL,
	"execution_id" text NOT NULL,
	"status" "webhook_delivery_status" DEFAULT 'pending' NOT NULL,
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
ALTER TABLE "user_rate_limits" ADD COLUMN "api_endpoint_requests" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_log_webhook" ADD CONSTRAINT "workflow_log_webhook_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_log_webhook_delivery" ADD CONSTRAINT "workflow_log_webhook_delivery_subscription_id_workflow_log_webhook_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."workflow_log_webhook"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_log_webhook_delivery" ADD CONSTRAINT "workflow_log_webhook_delivery_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workflow_log_webhook_workflow_id_idx" ON "workflow_log_webhook" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "workflow_log_webhook_active_idx" ON "workflow_log_webhook" USING btree ("active");--> statement-breakpoint
CREATE INDEX "workflow_log_webhook_delivery_subscription_id_idx" ON "workflow_log_webhook_delivery" USING btree ("subscription_id");--> statement-breakpoint
CREATE INDEX "workflow_log_webhook_delivery_execution_id_idx" ON "workflow_log_webhook_delivery" USING btree ("execution_id");--> statement-breakpoint
CREATE INDEX "workflow_log_webhook_delivery_status_idx" ON "workflow_log_webhook_delivery" USING btree ("status");--> statement-breakpoint
CREATE INDEX "workflow_log_webhook_delivery_next_attempt_idx" ON "workflow_log_webhook_delivery" USING btree ("next_attempt_at");