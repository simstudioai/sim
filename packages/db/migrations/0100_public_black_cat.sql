CREATE TABLE "workspace_file" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"key" text NOT NULL,
	"size" integer NOT NULL,
	"type" text NOT NULL,
	"uploaded_by" text NOT NULL,
	"uploaded_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_file_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "storage_used_bytes" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "user_stats" ADD COLUMN "storage_used_bytes" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_file" ADD CONSTRAINT "workspace_file_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_file" ADD CONSTRAINT "workspace_file_uploaded_by_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workspace_file_workspace_id_idx" ON "workspace_file" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "workspace_file_key_idx" ON "workspace_file" USING btree ("key");