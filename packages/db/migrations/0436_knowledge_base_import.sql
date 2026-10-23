ALTER TYPE "public"."upload_session_purpose" ADD VALUE IF NOT EXISTS 'knowledge_import' BEFORE 'knowledge_document';--> statement-breakpoint
CREATE TABLE "knowledge_base_import" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"source_key" text NOT NULL,
	"knowledge_base_id" text,
	"status" text DEFAULT 'running' NOT NULL,
	"documents_total" integer DEFAULT 0 NOT NULL,
	"documents_imported" integer DEFAULT 0 NOT NULL,
	"documents_failed" integer DEFAULT 0 NOT NULL,
	"vectors_reused" boolean DEFAULT false NOT NULL,
	"failures" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"started_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "knowledge_base_import" ADD CONSTRAINT "knowledge_base_import_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_base_import" ADD CONSTRAINT "knowledge_base_import_knowledge_base_id_knowledge_base_id_fk" FOREIGN KEY ("knowledge_base_id") REFERENCES "public"."knowledge_base"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "knowledge_base_import_watchdog_idx" ON "knowledge_base_import" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "knowledge_base_import_knowledge_base_id_idx" ON "knowledge_base_import" USING btree ("knowledge_base_id");