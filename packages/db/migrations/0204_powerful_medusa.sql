CREATE TYPE "public"."data_drain_cadence" AS ENUM('hourly', 'daily');--> statement-breakpoint
CREATE TYPE "public"."data_drain_destination" AS ENUM('s3', 'webhook');--> statement-breakpoint
CREATE TYPE "public"."data_drain_run_status" AS ENUM('running', 'success', 'failed');--> statement-breakpoint
CREATE TYPE "public"."data_drain_run_trigger" AS ENUM('cron', 'manual');--> statement-breakpoint
CREATE TYPE "public"."data_drain_source" AS ENUM('workflow_logs', 'job_logs', 'audit_logs', 'copilot_chats', 'copilot_runs');--> statement-breakpoint
CREATE TABLE "data_drain_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"drain_id" text NOT NULL,
	"status" "data_drain_run_status" NOT NULL,
	"trigger" "data_drain_run_trigger" NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp,
	"rows_exported" integer DEFAULT 0 NOT NULL,
	"bytes_written" bigint DEFAULT 0 NOT NULL,
	"cursor_before" text,
	"cursor_after" text,
	"error" text,
	"locators" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "data_drains" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"source" "data_drain_source" NOT NULL,
	"destination_type" "data_drain_destination" NOT NULL,
	"destination_config" jsonb NOT NULL,
	"destination_credentials" text NOT NULL,
	"schedule_cadence" "data_drain_cadence" NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"cursor" text,
	"last_run_at" timestamp,
	"last_success_at" timestamp,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "data_drain_runs" ADD CONSTRAINT "data_drain_runs_drain_id_data_drains_id_fk" FOREIGN KEY ("drain_id") REFERENCES "public"."data_drains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_drains" ADD CONSTRAINT "data_drains_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_drains" ADD CONSTRAINT "data_drains_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "data_drain_runs_drain_started_idx" ON "data_drain_runs" USING btree ("drain_id","started_at");--> statement-breakpoint
CREATE INDEX "data_drains_org_idx" ON "data_drains" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "data_drains_due_idx" ON "data_drains" USING btree ("enabled","last_run_at");--> statement-breakpoint
CREATE UNIQUE INDEX "data_drains_org_name_unique" ON "data_drains" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX "audit_log_workspace_created_at_id_idx" ON "audit_log" USING btree ("workspace_id",date_trunc('milliseconds', "created_at"),"id");--> statement-breakpoint
CREATE INDEX "copilot_chats_workspace_created_at_id_idx" ON "copilot_chats" USING btree ("workspace_id",date_trunc('milliseconds', "created_at"),"id");--> statement-breakpoint
CREATE INDEX "copilot_runs_workspace_completed_at_id_idx" ON "copilot_runs" USING btree ("workspace_id",date_trunc('milliseconds', "completed_at"),"id");--> statement-breakpoint
CREATE INDEX "job_execution_logs_workspace_ended_at_id_idx" ON "job_execution_logs" USING btree ("workspace_id",date_trunc('milliseconds', "ended_at"),"id");--> statement-breakpoint
CREATE INDEX "workflow_execution_logs_workspace_ended_at_id_idx" ON "workflow_execution_logs" USING btree ("workspace_id",date_trunc('milliseconds', "ended_at"),"id");