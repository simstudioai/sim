ALTER TABLE "copilot_chats" ALTER COLUMN "workflow_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "copilot_chats" ADD COLUMN "workspace_id" text;--> statement-breakpoint
ALTER TABLE "copilot_chats" ADD CONSTRAINT "copilot_chats_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "copilot_chats_user_workspace_idx" ON "copilot_chats" USING btree ("user_id","workspace_id");