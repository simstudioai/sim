CREATE TABLE "workspace_file_collab_state" (
	"file_id" text PRIMARY KEY NOT NULL,
	"doc_state" "bytea" NOT NULL,
	"source_hash" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspace_file_collab_state" ADD CONSTRAINT "workspace_file_collab_state_file_id_workspace_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."workspace_files"("id") ON DELETE cascade ON UPDATE no action;