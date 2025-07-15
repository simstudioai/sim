CREATE TABLE "copilot_chats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"workflow_id" text NOT NULL,
	"title" text,
	"messages" jsonb DEFAULT '[]' NOT NULL,
	"model" text DEFAULT 'claude-3-7-sonnet-latest' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "copilot_chats" ADD CONSTRAINT "copilot_chats_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copilot_chats" ADD CONSTRAINT "copilot_chats_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "copilot_chats_user_id_idx" ON "copilot_chats" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "copilot_chats_workflow_id_idx" ON "copilot_chats" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "copilot_chats_user_workflow_idx" ON "copilot_chats" USING btree ("user_id","workflow_id");--> statement-breakpoint
CREATE INDEX "copilot_chats_created_at_idx" ON "copilot_chats" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "copilot_chats_updated_at_idx" ON "copilot_chats" USING btree ("updated_at");