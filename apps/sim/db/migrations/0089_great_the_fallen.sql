CREATE TABLE "workspace_api_key" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"created_by" text,
	"name" text NOT NULL,
	"key" text NOT NULL,
	"last_used" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp,
	CONSTRAINT "workspace_api_key_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "workspace_api_key" ADD CONSTRAINT "workspace_api_key_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_api_key" ADD CONSTRAINT "workspace_api_key_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workspace_api_key_workspace_id_idx" ON "workspace_api_key" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_api_key_workspace_name_idx" ON "workspace_api_key" USING btree ("workspace_id","name");--> statement-breakpoint
CREATE INDEX "workspace_api_key_key_idx" ON "workspace_api_key" USING btree ("key");--> statement-breakpoint
CREATE INDEX "workspace_api_key_created_by_idx" ON "workspace_api_key" USING btree ("created_by");