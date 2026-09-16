CREATE TABLE "organization_access_request_settings" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"allow_requests" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "permission_access_request" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"requester_id" text NOT NULL,
	"workspace_id" text,
	"scope_key" text NOT NULL,
	"target_key" text NOT NULL,
	"target" jsonb NOT NULL,
	"target_label" text NOT NULL,
	"membership_id" text NOT NULL,
	"group_id" text,
	"group_name" text,
	"reason" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decision_reason" text,
	"decided_by" text,
	"decision" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"decided_at" timestamp,
	CONSTRAINT "permission_access_request_status_check" CHECK ("permission_access_request"."status" in ('pending', 'fulfilled', 'declined', 'cancelled', 'closed'))
);
--> statement-breakpoint
ALTER TABLE "organization_access_request_settings" ADD CONSTRAINT "organization_access_request_settings_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_access_request_settings" ADD CONSTRAINT "organization_access_request_settings_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_access_request" ADD CONSTRAINT "permission_access_request_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_access_request" ADD CONSTRAINT "permission_access_request_requester_id_user_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_access_request" ADD CONSTRAINT "permission_access_request_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_access_request" ADD CONSTRAINT "permission_access_request_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "permission_access_request_pending_unique" ON "permission_access_request" USING btree ("organization_id","requester_id","scope_key","target_key") WHERE "permission_access_request"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "permission_access_request_org_queue_idx" ON "permission_access_request" USING btree ("organization_id","status","created_at","id");--> statement-breakpoint
CREATE INDEX "permission_access_request_requester_idx" ON "permission_access_request" USING btree ("organization_id","requester_id","scope_key","created_at","id");