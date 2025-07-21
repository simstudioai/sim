CREATE TABLE "copilot_checkpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"workflow_id" text NOT NULL,
	"chat_id" uuid NOT NULL,
	"yaml" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "copilot_checkpoints" ADD CONSTRAINT "copilot_checkpoints_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copilot_checkpoints" ADD CONSTRAINT "copilot_checkpoints_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copilot_checkpoints" ADD CONSTRAINT "copilot_checkpoints_chat_id_copilot_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."copilot_chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "copilot_checkpoints_user_id_idx" ON "copilot_checkpoints" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "copilot_checkpoints_workflow_id_idx" ON "copilot_checkpoints" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "copilot_checkpoints_chat_id_idx" ON "copilot_checkpoints" USING btree ("chat_id");--> statement-breakpoint
CREATE INDEX "copilot_checkpoints_user_workflow_idx" ON "copilot_checkpoints" USING btree ("user_id","workflow_id");--> statement-breakpoint
CREATE INDEX "copilot_checkpoints_workflow_chat_idx" ON "copilot_checkpoints" USING btree ("workflow_id","chat_id");--> statement-breakpoint
CREATE INDEX "copilot_checkpoints_created_at_idx" ON "copilot_checkpoints" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "copilot_checkpoints_chat_created_at_idx" ON "copilot_checkpoints" USING btree ("chat_id","created_at");