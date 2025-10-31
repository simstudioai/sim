ALTER TABLE "custom_tools" DROP CONSTRAINT "custom_tools_user_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "custom_tools" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
-- Add workspace_id as nullable (existing tools will have null, new tools will be workspace-scoped)
ALTER TABLE "custom_tools" ADD COLUMN "workspace_id" text;--> statement-breakpoint
ALTER TABLE "custom_tools" ADD CONSTRAINT "custom_tools_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_tools" ADD CONSTRAINT "custom_tools_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "custom_tools_workspace_id_idx" ON "custom_tools" USING btree ("workspace_id");