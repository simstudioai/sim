CREATE TABLE "mothership_resource_effects" (
	"chat_id" uuid NOT NULL,
	"effect_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "mothership_resource_effects_chat_id_effect_id_pk" PRIMARY KEY("chat_id","effect_id")
);
--> statement-breakpoint
ALTER TABLE "mothership_resource_effects" ADD CONSTRAINT "mothership_resource_effects_chat_id_copilot_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."copilot_chats"("id") ON DELETE cascade ON UPDATE no action;