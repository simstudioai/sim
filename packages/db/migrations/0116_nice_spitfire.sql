CREATE TABLE "superagent_chats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"title" text,
	"messages" jsonb DEFAULT '[]' NOT NULL,
	"model" text DEFAULT 'claude-sonnet-4-5' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "superagent_chats" ADD CONSTRAINT "superagent_chats_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "superagent_chats" ADD CONSTRAINT "superagent_chats_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "superagent_chats_user_id_idx" ON "superagent_chats" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "superagent_chats_workspace_id_idx" ON "superagent_chats" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "superagent_chats_user_workspace_idx" ON "superagent_chats" USING btree ("user_id","workspace_id");--> statement-breakpoint
CREATE INDEX "superagent_chats_created_at_idx" ON "superagent_chats" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "superagent_chats_updated_at_idx" ON "superagent_chats" USING btree ("updated_at");