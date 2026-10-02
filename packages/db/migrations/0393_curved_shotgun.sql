CREATE TABLE "freebuff_attribution" (
	"user_id" text PRIMARY KEY NOT NULL,
	"encrypted_token" text NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "freebuff_attribution" ADD CONSTRAINT "freebuff_attribution_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;