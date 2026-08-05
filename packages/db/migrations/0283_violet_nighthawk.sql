-- migration-safe: additive private table; no existing rows or deployed queries are changed
CREATE TABLE "workspace_file_secret_provenance" (
	"file_id" text PRIMARY KEY NOT NULL,
	"content_updated_at" timestamp NOT NULL,
	"status" text NOT NULL,
	"entries" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_file_secret_provenance_status_check" CHECK ("workspace_file_secret_provenance"."status" IN ('exact', 'unknown'))
);
--> statement-breakpoint
ALTER TABLE "workspace_file_secret_provenance" ADD CONSTRAINT "workspace_file_secret_provenance_file_id_workspace_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."workspace_files"("id") ON DELETE cascade ON UPDATE no action;
