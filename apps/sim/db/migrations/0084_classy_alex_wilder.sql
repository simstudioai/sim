CREATE TABLE "copilot_stats" (
	"user_id" text,
	"chat_id" uuid,
	"message_id" text,
	"depth" integer,
	"created_at" timestamp DEFAULT now(),
	"diff_created" boolean,
	"diff_accepted" boolean
);
--> statement-breakpoint
ALTER TABLE "copilot_stats" ADD CONSTRAINT "copilot_stats_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copilot_stats" ADD CONSTRAINT "copilot_stats_chat_id_copilot_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."copilot_chats"("id") ON DELETE cascade ON UPDATE no action;