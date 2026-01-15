ALTER TABLE "session" ADD COLUMN "impersonated_by" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "role" text;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_impersonated_by_user_id_fk" FOREIGN KEY ("impersonated_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;