CREATE TABLE "agent_chat" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"user_id" text NOT NULL,
	"title" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_chat_message" (
	"id" text PRIMARY KEY NOT NULL,
	"chat_id" text NOT NULL,
	"role" text NOT NULL,
	"content" text,
	"tool_call_data" json,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"order" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_chat" ADD CONSTRAINT "agent_chat_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_chat" ADD CONSTRAINT "agent_chat_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_chat_message" ADD CONSTRAINT "agent_chat_message_chat_id_agent_chat_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."agent_chat"("id") ON DELETE cascade ON UPDATE no action;