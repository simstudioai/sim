CREATE TABLE "copilot_task_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"execution_id" text NOT NULL,
	"chat_id" uuid NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "copilot_task_subscriptions" ADD CONSTRAINT "copilot_task_subscriptions_chat_id_copilot_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."copilot_chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copilot_task_subscriptions" ADD CONSTRAINT "copilot_task_subscriptions_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copilot_task_subscriptions" ADD CONSTRAINT "copilot_task_subscriptions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "copilot_task_subscriptions_execution_idx" ON "copilot_task_subscriptions" USING btree ("execution_id");--> statement-breakpoint
CREATE UNIQUE INDEX "copilot_task_subscriptions_task_idx" ON "copilot_task_subscriptions" USING btree ("task_id");