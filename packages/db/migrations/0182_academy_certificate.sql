CREATE TYPE "public"."academy_cert_status" AS ENUM('active', 'revoked', 'expired');--> statement-breakpoint
CREATE TABLE "academy_certificate" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"course_id" text NOT NULL,
	"status" "academy_cert_status" DEFAULT 'active' NOT NULL,
	"issued_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp,
	"certificate_number" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "academy_certificate_certificate_number_unique" UNIQUE("certificate_number")
);
--> statement-breakpoint
ALTER TABLE "academy_certificate" ADD CONSTRAINT "academy_certificate_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "academy_certificate_user_id_idx" ON "academy_certificate" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "academy_certificate_course_id_idx" ON "academy_certificate" USING btree ("course_id");--> statement-breakpoint
CREATE UNIQUE INDEX "academy_certificate_user_course_unique" ON "academy_certificate" USING btree ("user_id","course_id");--> statement-breakpoint
CREATE INDEX "academy_certificate_number_idx" ON "academy_certificate" USING btree ("certificate_number");--> statement-breakpoint
CREATE INDEX "academy_certificate_status_idx" ON "academy_certificate" USING btree ("status");