ALTER TABLE "knowledge_connector_member" ADD COLUMN "scope_renewed_at" timestamp;--> statement-breakpoint
ALTER TABLE "knowledge_connector_member" ADD COLUMN "scope_renewal_cursor" text;--> statement-breakpoint
ALTER TABLE "knowledge_connector_member" ADD COLUMN "scope_renewal_started_at" timestamp;--> statement-breakpoint
ALTER TABLE "knowledge_connector_member_sync_log" ADD COLUMN "observations_renewed" integer DEFAULT 0 NOT NULL;