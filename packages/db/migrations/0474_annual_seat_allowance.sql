ALTER TABLE "subscription" ADD COLUMN "allowance_period_start" timestamp;--> statement-breakpoint
ALTER TABLE "subscription" ADD COLUMN "allowance_seats" integer;--> statement-breakpoint
ALTER TABLE "subscription" ADD COLUMN "allowance_seat_months" integer;