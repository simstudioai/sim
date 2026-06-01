CREATE TABLE "mothership_settings" (
	"workspace_id" text PRIMARY KEY NOT NULL,
	"mcp_tool_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"custom_tool_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"skill_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "mothership_environment" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "mothership_settings" ADD CONSTRAINT "mothership_settings_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mothership_settings_workspace_id_idx" ON "mothership_settings" USING btree ("workspace_id");