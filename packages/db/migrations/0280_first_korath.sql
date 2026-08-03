CREATE TABLE "table_imports" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"upload_session_id" text,
	"source_file_id" text,
	"source_type" text NOT NULL,
	"target_type" text NOT NULL,
	"table_id" text,
	"source" jsonb NOT NULL,
	"target" jsonb NOT NULL,
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text NOT NULL,
	"rows_processed" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "upload_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"purpose" text NOT NULL,
	"storage_context" text NOT NULL,
	"storage_key" text NOT NULL,
	"storage_provider" text NOT NULL,
	"provider_upload_id" text,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"file_size" bigint NOT NULL,
	"part_size" integer NOT NULL,
	"part_count" integer NOT NULL,
	"status" text DEFAULT 'uploading' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"completed_file_id" text,
	"error" text,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	CONSTRAINT "upload_sessions_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
ALTER TABLE "table_imports" ADD CONSTRAINT "table_imports_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "table_imports" ADD CONSTRAINT "table_imports_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "table_imports" ADD CONSTRAINT "table_imports_upload_session_id_upload_sessions_id_fk" FOREIGN KEY ("upload_session_id") REFERENCES "public"."upload_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "table_imports" ADD CONSTRAINT "table_imports_source_file_id_workspace_files_id_fk" FOREIGN KEY ("source_file_id") REFERENCES "public"."workspace_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "table_imports" ADD CONSTRAINT "table_imports_table_id_user_table_definitions_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."user_table_definitions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_completed_file_id_workspace_files_id_fk" FOREIGN KEY ("completed_file_id") REFERENCES "public"."workspace_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "table_imports_workspace_created_idx" ON "table_imports" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "table_imports_status_updated_idx" ON "table_imports" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "table_imports_table_idx" ON "table_imports" USING btree ("table_id");--> statement-breakpoint
CREATE INDEX "upload_sessions_workspace_created_idx" ON "upload_sessions" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "upload_sessions_status_expiry_idx" ON "upload_sessions" USING btree ("status","expires_at");