CREATE TABLE "member_profile" (
	"member_id" text PRIMARY KEY NOT NULL,
	"title" text,
	"department" text,
	"location" text,
	"start_date" date,
	"manager_member_id" text,
	"updated_by" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "member_profile_not_own_manager" CHECK ("member_profile"."manager_member_id" <> "member_profile"."member_id")
);
--> statement-breakpoint
ALTER TABLE "member_profile" ADD CONSTRAINT "member_profile_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_profile" ADD CONSTRAINT "member_profile_manager_member_id_member_id_fk" FOREIGN KEY ("manager_member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_profile" ADD CONSTRAINT "member_profile_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "member_profile_manager_member_id_idx" ON "member_profile" USING btree ("manager_member_id");--> statement-breakpoint
CREATE INDEX "member_profile_updated_by_idx" ON "member_profile" USING btree ("updated_by");