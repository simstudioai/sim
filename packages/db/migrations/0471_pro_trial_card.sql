-- Replay-safe: 0470's embedded COMMIT leaves this file in autocommit, and a lock-timeout retry
-- replays every unjournaled file from the top.
CREATE TABLE IF NOT EXISTS "trial_card" (
	"fingerprint" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"stripe_subscription_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trial_card_user_id_user_id_fk' AND conrelid = 'trial_card'::regclass) THEN
ALTER TABLE "trial_card" ADD CONSTRAINT "trial_card_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
END IF;
END $$;
