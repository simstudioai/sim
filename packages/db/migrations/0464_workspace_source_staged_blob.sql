CREATE TABLE "workspace_source_staged_blob" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"scope" text NOT NULL,
	"sha256" text NOT NULL,
	"size" integer NOT NULL,
	"storage_key" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspace_source_staged_blob" ADD CONSTRAINT "workspace_source_staged_blob_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_source_staged_blob_scope_hash_unique" ON "workspace_source_staged_blob" USING btree ("workspace_id","scope","sha256");--> statement-breakpoint
CREATE INDEX "workspace_source_staged_blob_expires_at_idx" ON "workspace_source_staged_blob" USING btree ("expires_at");