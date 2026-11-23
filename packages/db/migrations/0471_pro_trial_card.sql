CREATE TABLE "trial_card" (
	"fingerprint" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"stripe_subscription_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trial_card" ADD CONSTRAINT "trial_card_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;