-- Replay-safety: this file ends in CONCURRENTLY index ops below an embedded COMMIT,
-- so a failure there leaves the migration unjournaled and replays the whole file
-- from the top — every statement here is idempotent (IF NOT EXISTS / duplicate_object),
-- and each CONCURRENTLY build drops any INVALID leftover before rebuilding.
CREATE TABLE IF NOT EXISTS "webhook_path_claim" (
	"path" text PRIMARY KEY NOT NULL,
	"workflow_id" text NOT NULL,
	"generation" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_path_claim_generation_check" CHECK ("webhook_path_claim"."generation" >= 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workflow_deployment_operation" (
	"id" text PRIMARY KEY NOT NULL,
	"workflow_id" text NOT NULL,
	"deployment_version_id" text NOT NULL,
	"version" integer NOT NULL,
	"previous_active_version_id" text,
	"action" text NOT NULL,
	"protocol_version" integer NOT NULL,
	"generation" integer NOT NULL,
	"status" text DEFAULT 'preparing' NOT NULL,
	"component_readiness" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error_code" text,
	"error_message" text,
	"idempotency_key" text,
	"request_hash" text NOT NULL,
	"actor_id" text NOT NULL,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_deployment_operation_action_check" CHECK ("workflow_deployment_operation"."action" IN ('deploy', 'activate')),
	CONSTRAINT "workflow_deployment_operation_status_check" CHECK ("workflow_deployment_operation"."status" IN ('preparing', 'activating', 'active', 'failed', 'superseded')),
	CONSTRAINT "workflow_deployment_operation_generation_check" CHECK ("workflow_deployment_operation"."generation" > 0),
	CONSTRAINT "workflow_deployment_operation_protocol_version_check" CHECK ("workflow_deployment_operation"."protocol_version" > 0)
);
--> statement-breakpoint
ALTER TABLE "webhook" ADD COLUMN IF NOT EXISTS "registration_status" text;--> statement-breakpoint
ALTER TABLE "webhook" ADD COLUMN IF NOT EXISTS "registration_generation" integer;--> statement-breakpoint
ALTER TABLE "webhook" ADD COLUMN IF NOT EXISTS "config_fingerprint" text;--> statement-breakpoint
ALTER TABLE "webhook" ADD COLUMN IF NOT EXISTS "prepared_at" timestamp;--> statement-breakpoint
ALTER TABLE "workflow_schedule" ADD COLUMN IF NOT EXISTS "deployment_operation_id" text;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "webhook_path_claim" ADD CONSTRAINT "webhook_path_claim_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "workflow_deployment_operation" ADD CONSTRAINT "workflow_deployment_operation_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "workflow_deployment_operation" ADD CONSTRAINT "workflow_deployment_operation_deployment_version_id_workflow_deployment_version_id_fk" FOREIGN KEY ("deployment_version_id") REFERENCES "public"."workflow_deployment_version"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "workflow_deployment_operation" ADD CONSTRAINT "workflow_deployment_operation_previous_active_version_id_workflow_deployment_version_id_fk" FOREIGN KEY ("previous_active_version_id") REFERENCES "public"."workflow_deployment_version"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhook_path_claim_workflow_idx" ON "webhook_path_claim" USING btree ("workflow_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "workflow_deployment_operation_workflow_generation_unique" ON "workflow_deployment_operation" USING btree ("workflow_id","generation");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "workflow_deployment_operation_workflow_idempotency_unique" ON "workflow_deployment_operation" USING btree ("workflow_id","idempotency_key") WHERE "workflow_deployment_operation"."idempotency_key" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "workflow_deployment_operation_workflow_in_flight_unique" ON "workflow_deployment_operation" USING btree ("workflow_id") WHERE "workflow_deployment_operation"."status" IN ('preparing', 'activating');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_deployment_operation_workflow_status_idx" ON "workflow_deployment_operation" USING btree ("workflow_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_deployment_operation_deployment_version_idx" ON "workflow_deployment_operation" USING btree ("deployment_version_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_deployment_operation_workflow_version_generation_idx" ON "workflow_deployment_operation" USING btree ("workflow_id","deployment_version_id","generation" DESC NULLS LAST);--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "workflow_schedule" ADD CONSTRAINT "workflow_schedule_deployment_operation_id_workflow_deployment_operation_id_fk" FOREIGN KEY ("deployment_operation_id") REFERENCES "public"."workflow_deployment_operation"("id") ON DELETE set null ON UPDATE no action NOT VALID;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "webhook" ADD CONSTRAINT "webhook_registration_status_check" CHECK ("webhook"."registration_status" IS NULL OR "webhook"."registration_status" IN ('active', 'candidate', 'retired', 'orphaned')) NOT VALID;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "webhook" ADD CONSTRAINT "webhook_registration_generation_check" CHECK ("webhook"."registration_generation" IS NULL OR "webhook"."registration_generation" >= 0) NOT VALID;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
COMMIT;--> statement-breakpoint
SET lock_timeout = 0;--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS "webhook_active_registration_unique";--> statement-breakpoint
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "webhook_active_registration_unique" ON "webhook" USING btree ("workflow_id","block_id") WHERE "webhook"."registration_status" = 'active' AND "webhook"."block_id" IS NOT NULL AND "webhook"."archived_at" IS NULL;--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS "webhook_candidate_registration_unique";--> statement-breakpoint
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "webhook_candidate_registration_unique" ON "webhook" USING btree ("workflow_id","block_id") WHERE "webhook"."registration_status" = 'candidate' AND "webhook"."block_id" IS NOT NULL;--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS "webhook_registration_status_generation_idx";--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "webhook_registration_status_generation_idx" ON "webhook" USING btree ("workflow_id","registration_status","registration_generation");--> statement-breakpoint
SET lock_timeout = '5s';
