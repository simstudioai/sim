-- Replay-safe: 0470's embedded COMMIT leaves this file in autocommit, and a lock-timeout retry
-- replays every unjournaled file from the top.
ALTER TABLE "subscription" ADD COLUMN IF NOT EXISTS "allowance_period_start" timestamp;--> statement-breakpoint
ALTER TABLE "subscription" ADD COLUMN IF NOT EXISTS "allowance_seats" integer;--> statement-breakpoint
ALTER TABLE "subscription" ADD COLUMN IF NOT EXISTS "allowance_seat_months" numeric;
