CREATE TABLE "workspace_byok_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"encrypted_api_key" text NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspace_byok_keys" ADD CONSTRAINT "workspace_byok_keys_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_byok_keys" ADD CONSTRAINT "workspace_byok_keys_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_byok_provider_unique" ON "workspace_byok_keys" USING btree ("workspace_id","provider_id");--> statement-breakpoint
CREATE INDEX "workspace_byok_workspace_idx" ON "workspace_byok_keys" USING btree ("workspace_id");