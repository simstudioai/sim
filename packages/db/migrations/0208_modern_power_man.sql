CREATE TABLE "workspace_file_folders" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"parent_id" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "workspace_files_workspace_name_active_unique";--> statement-breakpoint
ALTER TABLE "workspace_files" ADD COLUMN "folder_id" text;--> statement-breakpoint
ALTER TABLE "workspace_file_folders" ADD CONSTRAINT "workspace_file_folders_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_file_folders" ADD CONSTRAINT "workspace_file_folders_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_file_folders" ADD CONSTRAINT "workspace_file_folders_parent_id_workspace_file_folders_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."workspace_file_folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workspace_file_folders_workspace_parent_idx" ON "workspace_file_folders" USING btree ("workspace_id","parent_id");--> statement-breakpoint
CREATE INDEX "workspace_file_folders_parent_sort_idx" ON "workspace_file_folders" USING btree ("parent_id","sort_order");--> statement-breakpoint
CREATE INDEX "workspace_file_folders_deleted_at_idx" ON "workspace_file_folders" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "workspace_file_folders_workspace_deleted_partial_idx" ON "workspace_file_folders" USING btree ("workspace_id","deleted_at") WHERE "workspace_file_folders"."deleted_at" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_file_folders_workspace_parent_name_active_unique" ON "workspace_file_folders" USING btree ("workspace_id",coalesce("parent_id", ''),"name") WHERE "workspace_file_folders"."deleted_at" IS NULL;--> statement-breakpoint
ALTER TABLE "workspace_files" ADD CONSTRAINT "workspace_files_folder_id_workspace_file_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."workspace_file_folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_files_workspace_folder_name_active_unique" ON "workspace_files" USING btree ("workspace_id",coalesce("folder_id", ''),"original_name") WHERE "workspace_files"."deleted_at" IS NULL AND "workspace_files"."context" = 'workspace' AND "workspace_files"."workspace_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "workspace_files_folder_id_idx" ON "workspace_files" USING btree ("folder_id");