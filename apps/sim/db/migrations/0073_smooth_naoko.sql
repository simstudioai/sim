CREATE TABLE "copilot_api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"api_key_encrypted" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "copilot_api_keys" ADD CONSTRAINT "copilot_api_keys_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;