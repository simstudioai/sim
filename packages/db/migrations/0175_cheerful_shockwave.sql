ALTER TABLE "workspace_files" ADD COLUMN "chat_id" uuid;--> statement-breakpoint
ALTER TABLE "workspace_files" ADD CONSTRAINT "workspace_files_chat_id_copilot_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."copilot_chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workspace_files_chat_id_idx" ON "workspace_files" USING btree ("chat_id");