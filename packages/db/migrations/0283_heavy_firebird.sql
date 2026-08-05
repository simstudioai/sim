CREATE TYPE "public"."upload_session_method" AS ENUM('put', 'multipart');--> statement-breakpoint
CREATE TYPE "public"."upload_session_provider" AS ENUM('local', 's3', 'blob', 'gcs');--> statement-breakpoint
CREATE TYPE "public"."upload_session_purpose" AS ENUM('workspace_file', 'table_import', 'knowledge_document', 'profile_picture', 'workspace_logo', 'mothership_attachment', 'execution_attachment');--> statement-breakpoint
CREATE TYPE "public"."upload_session_status" AS ENUM('uploading', 'completing', 'finalizing', 'completed', 'aborting', 'aborted', 'failed', 'expired');--> statement-breakpoint
CREATE TABLE "upload_session" (
	"id" text PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"knowledge_base_id" text,
	"workflow_id" text,
	"execution_id" text,
	"purpose" "upload_session_purpose" NOT NULL,
	"method" "upload_session_method" NOT NULL,
	"storage_context" text NOT NULL,
	"final_key" text NOT NULL,
	"storage_provider" "upload_session_provider" NOT NULL,
	"provider_upload_id" text,
	"provider_object_version" text,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"file_size" bigint NOT NULL,
	"part_size" integer,
	"part_count" integer,
	"status" "upload_session_status" DEFAULT 'uploading' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"processing_lease_id" text,
	"processing_lease_expires_at" timestamp,
	"completed_file_id" text,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"completed_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "upload_session_token_hash_unique" ON "upload_session" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "upload_session_final_key_unique" ON "upload_session" USING btree ("final_key");--> statement-breakpoint
CREATE INDEX "upload_session_status_expires_at_idx" ON "upload_session" USING btree ("status","expires_at");