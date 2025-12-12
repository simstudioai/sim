CREATE TABLE "workspace_files" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"context" text NOT NULL,
	"original_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size" integer NOT NULL,
	"uploaded_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_files_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "workspace_files" ADD CONSTRAINT "workspace_files_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_files" ADD CONSTRAINT "workspace_files_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workspace_files_key_idx" ON "workspace_files" USING btree ("key");--> statement-breakpoint
CREATE INDEX "workspace_files_user_id_idx" ON "workspace_files" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "workspace_files_workspace_id_idx" ON "workspace_files" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "workspace_files_context_idx" ON "workspace_files" USING btree ("context");