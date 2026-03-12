ALTER TABLE "copilot_chats" ADD COLUMN "last_seen_at" timestamp;
UPDATE "copilot_chats" SET "last_seen_at" = "updated_at" WHERE "last_seen_at" IS NULL;