CREATE TABLE "copilot_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chat_id" uuid NOT NULL,
	"message_id" text NOT NULL,
	"role" text NOT NULL,
	"content" jsonb NOT NULL,
	"stream_id" text,
	"parent_message_id" text,
	"model" text,
	"tokens_in" integer,
	"tokens_out" integer,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "copilot_messages" ADD CONSTRAINT "copilot_messages_chat_id_copilot_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."copilot_chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "copilot_messages_chat_message_unique" ON "copilot_messages" USING btree ("chat_id","message_id");--> statement-breakpoint
CREATE INDEX "copilot_messages_chat_created_at_idx" ON "copilot_messages" USING btree ("chat_id","created_at","id") WHERE "copilot_messages"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "copilot_messages_chat_stream_idx" ON "copilot_messages" USING btree ("chat_id","stream_id") WHERE "copilot_messages"."stream_id" IS NOT NULL;--> statement-breakpoint
INSERT INTO "copilot_messages" ("chat_id", "message_id", "role", "content", "model", "created_at", "updated_at")
SELECT
  c."id",
  msg.value->>'id',
  msg.value->>'role',
  msg.value,
  c."model",
  (msg.value->>'timestamp')::timestamptz,
  (msg.value->>'timestamp')::timestamptz
FROM "copilot_chats" c
CROSS JOIN LATERAL jsonb_array_elements(c."messages") AS msg(value)
WHERE jsonb_typeof(c."messages") = 'array'
  AND jsonb_array_length(c."messages") > 0
ON CONFLICT ("chat_id", "message_id") DO NOTHING;
