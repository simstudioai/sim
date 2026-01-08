CREATE TYPE "public"."credential_set_invitation_status" AS ENUM('pending', 'accepted', 'expired', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."credential_set_member_status" AS ENUM('active', 'pending', 'revoked');--> statement-breakpoint
CREATE TABLE "credential_set" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"provider_id" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credential_set_invitation" (
	"id" text PRIMARY KEY NOT NULL,
	"credential_set_id" text NOT NULL,
	"email" text,
	"token" text NOT NULL,
	"invited_by" text NOT NULL,
	"status" "credential_set_invitation_status" DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"accepted_at" timestamp,
	"accepted_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "credential_set_invitation_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "credential_set_member" (
	"id" text PRIMARY KEY NOT NULL,
	"credential_set_id" text NOT NULL,
	"user_id" text NOT NULL,
	"status" "credential_set_member_status" DEFAULT 'pending' NOT NULL,
	"joined_at" timestamp,
	"invited_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "webhook" ADD COLUMN "credential_set_id" text;--> statement-breakpoint
ALTER TABLE "credential_set" ADD CONSTRAINT "credential_set_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_set" ADD CONSTRAINT "credential_set_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_set_invitation" ADD CONSTRAINT "credential_set_invitation_credential_set_id_credential_set_id_fk" FOREIGN KEY ("credential_set_id") REFERENCES "public"."credential_set"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_set_invitation" ADD CONSTRAINT "credential_set_invitation_invited_by_user_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_set_invitation" ADD CONSTRAINT "credential_set_invitation_accepted_by_user_id_user_id_fk" FOREIGN KEY ("accepted_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_set_member" ADD CONSTRAINT "credential_set_member_credential_set_id_credential_set_id_fk" FOREIGN KEY ("credential_set_id") REFERENCES "public"."credential_set"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_set_member" ADD CONSTRAINT "credential_set_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_set_member" ADD CONSTRAINT "credential_set_member_invited_by_user_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credential_set_organization_id_idx" ON "credential_set" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "credential_set_created_by_idx" ON "credential_set" USING btree ("created_by");--> statement-breakpoint
CREATE UNIQUE INDEX "credential_set_org_name_unique" ON "credential_set" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX "credential_set_provider_id_idx" ON "credential_set" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "credential_set_invitation_set_id_idx" ON "credential_set_invitation" USING btree ("credential_set_id");--> statement-breakpoint
CREATE INDEX "credential_set_invitation_token_idx" ON "credential_set_invitation" USING btree ("token");--> statement-breakpoint
CREATE INDEX "credential_set_invitation_status_idx" ON "credential_set_invitation" USING btree ("status");--> statement-breakpoint
CREATE INDEX "credential_set_invitation_expires_at_idx" ON "credential_set_invitation" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "credential_set_member_set_id_idx" ON "credential_set_member" USING btree ("credential_set_id");--> statement-breakpoint
CREATE INDEX "credential_set_member_user_id_idx" ON "credential_set_member" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "credential_set_member_unique" ON "credential_set_member" USING btree ("credential_set_id","user_id");--> statement-breakpoint
CREATE INDEX "credential_set_member_status_idx" ON "credential_set_member" USING btree ("status");--> statement-breakpoint
ALTER TABLE "webhook" ADD CONSTRAINT "webhook_credential_set_id_credential_set_id_fk" FOREIGN KEY ("credential_set_id") REFERENCES "public"."credential_set"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "webhook_credential_set_id_idx" ON "webhook" USING btree ("credential_set_id");