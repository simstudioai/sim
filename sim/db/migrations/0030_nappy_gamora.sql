ALTER TABLE "chatbot" RENAME TO "chat";--> statement-breakpoint
ALTER TABLE "chat" DROP CONSTRAINT "chatbot_workflow_id_workflow_id_fk";
--> statement-breakpoint
ALTER TABLE "chat" DROP CONSTRAINT "chatbot_user_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "chat" ADD CONSTRAINT "chat_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat" ADD CONSTRAINT "chat_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;