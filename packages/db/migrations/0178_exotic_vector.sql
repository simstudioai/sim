CREATE TABLE "copilot_workflow_read_hashes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chat_id" uuid NOT NULL,
	"workflow_id" text NOT NULL,
	"hash" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "copilot_workflow_read_hashes" ADD CONSTRAINT "copilot_workflow_read_hashes_chat_id_copilot_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."copilot_chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copilot_workflow_read_hashes" ADD CONSTRAINT "copilot_workflow_read_hashes_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "copilot_workflow_read_hashes_chat_id_idx" ON "copilot_workflow_read_hashes" USING btree ("chat_id");--> statement-breakpoint
CREATE INDEX "copilot_workflow_read_hashes_workflow_id_idx" ON "copilot_workflow_read_hashes" USING btree ("workflow_id");--> statement-breakpoint
CREATE UNIQUE INDEX "copilot_workflow_read_hashes_chat_workflow_unique" ON "copilot_workflow_read_hashes" USING btree ("chat_id","workflow_id");