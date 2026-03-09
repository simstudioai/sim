CREATE TABLE "copilot_feedback" (
	"feedback_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"chat_id" uuid NOT NULL,
	"user_query" text NOT NULL,
	"agent_response" text NOT NULL,
	"is_positive" boolean NOT NULL,
	"feedback" text,
	"workflow_yaml" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_stats" ALTER COLUMN "current_usage_limit" SET DEFAULT '10';--> statement-breakpoint
ALTER TABLE "copilot_feedback" ADD CONSTRAINT "copilot_feedback_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copilot_feedback" ADD CONSTRAINT "copilot_feedback_chat_id_copilot_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."copilot_chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "copilot_feedback_user_id_idx" ON "copilot_feedback" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "copilot_feedback_chat_id_idx" ON "copilot_feedback" USING btree ("chat_id");--> statement-breakpoint
CREATE INDEX "copilot_feedback_user_chat_idx" ON "copilot_feedback" USING btree ("user_id","chat_id");--> statement-breakpoint
CREATE INDEX "copilot_feedback_is_positive_idx" ON "copilot_feedback" USING btree ("is_positive");--> statement-breakpoint
CREATE INDEX "copilot_feedback_created_at_idx" ON "copilot_feedback" USING btree ("created_at");