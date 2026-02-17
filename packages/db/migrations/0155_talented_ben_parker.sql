CREATE TABLE "knowledge_connector" (
	"id" text PRIMARY KEY NOT NULL,
	"knowledge_base_id" text NOT NULL,
	"connector_type" text NOT NULL,
	"credential_id" text NOT NULL,
	"source_config" json NOT NULL,
	"sync_mode" text DEFAULT 'incremental' NOT NULL,
	"sync_interval_minutes" integer DEFAULT 1440 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"last_sync_at" timestamp,
	"last_sync_error" text,
	"last_sync_doc_count" integer,
	"next_sync_at" timestamp,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "knowledge_connector_sync_log" (
	"id" text PRIMARY KEY NOT NULL,
	"connector_id" text NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"docs_added" integer DEFAULT 0 NOT NULL,
	"docs_updated" integer DEFAULT 0 NOT NULL,
	"docs_deleted" integer DEFAULT 0 NOT NULL,
	"docs_unchanged" integer DEFAULT 0 NOT NULL,
	"error_message" text
);
--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "user_excluded" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "connector_id" text;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "content_hash" text;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "source_url" text;--> statement-breakpoint
ALTER TABLE "knowledge_connector" ADD CONSTRAINT "knowledge_connector_knowledge_base_id_knowledge_base_id_fk" FOREIGN KEY ("knowledge_base_id") REFERENCES "public"."knowledge_base"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_connector_sync_log" ADD CONSTRAINT "knowledge_connector_sync_log_connector_id_knowledge_connector_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."knowledge_connector"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kc_knowledge_base_id_idx" ON "knowledge_connector" USING btree ("knowledge_base_id");--> statement-breakpoint
CREATE INDEX "kc_status_next_sync_idx" ON "knowledge_connector" USING btree ("status","next_sync_at");--> statement-breakpoint
CREATE INDEX "kcsl_connector_id_idx" ON "knowledge_connector_sync_log" USING btree ("connector_id");--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_connector_id_knowledge_connector_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."knowledge_connector"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "doc_connector_external_id_idx" ON "document" USING btree ("connector_id","external_id") WHERE "document"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "doc_connector_id_idx" ON "document" USING btree ("connector_id");