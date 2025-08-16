CREATE TABLE "copilot_api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"api_key_encrypted" text NOT NULL,
	"api_key_lookup" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_stats" ADD COLUMN "total_copilot_cost" numeric DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_stats" ADD COLUMN "total_copilot_tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "user_stats" ADD COLUMN "total_copilot_calls" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "copilot_api_keys" ADD CONSTRAINT "copilot_api_keys_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "copilot_api_keys_api_key_encrypted_hash_idx" ON "copilot_api_keys" USING hash ("api_key_encrypted");--> statement-breakpoint
CREATE INDEX "copilot_api_keys_lookup_hash_idx" ON "copilot_api_keys" USING hash ("api_key_lookup");