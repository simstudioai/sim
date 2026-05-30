ALTER TABLE "copilot_messages" ADD COLUMN IF NOT EXISTS "seq" integer;--> statement-breakpoint
WITH ordered AS (
  SELECT c."id" AS chat_id, elem.value->>'id' AS message_id, elem.ord AS ord
  FROM "copilot_chats" c
  CROSS JOIN LATERAL jsonb_array_elements(c."messages") WITH ORDINALITY AS elem(value, ord)
  WHERE jsonb_typeof(c."messages") = 'array' AND jsonb_array_length(c."messages") > 0
),
first_occurrence AS (
  SELECT chat_id, message_id, MIN(ord) AS first_ord FROM ordered GROUP BY chat_id, message_id
),
ranked AS (
  SELECT chat_id, message_id,
         (ROW_NUMBER() OVER (PARTITION BY chat_id ORDER BY first_ord) - 1) AS seq
  FROM first_occurrence
)
UPDATE "copilot_messages" m SET "seq" = r.seq
FROM ranked r
WHERE m."chat_id" = r.chat_id AND m."message_id" = r.message_id;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "copilot_messages_chat_seq_idx" ON "copilot_messages" USING btree ("chat_id","seq") WHERE "copilot_messages"."deleted_at" IS NULL;