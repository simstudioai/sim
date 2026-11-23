CREATE TABLE "people_directory_entry" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"source" text NOT NULL,
	"external_id" text NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"title" text,
	"department" text,
	"location" text,
	"manager_external_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "people_directory_page" (
	"organization_id" text NOT NULL,
	"run_id" text NOT NULL,
	"page_hash" text NOT NULL,
	CONSTRAINT "people_directory_page_organization_id_run_id_page_hash_pk" PRIMARY KEY("organization_id","run_id","page_hash")
);
--> statement-breakpoint
CREATE TABLE "people_directory_stage" (
	"organization_id" text NOT NULL,
	"run_id" text NOT NULL,
	"external_id" text NOT NULL,
	"proposed_id" text NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"title" text,
	"department" text,
	"location" text,
	"manager_external_id" text,
	"reports_cursor" text,
	"reports_complete" boolean DEFAULT false NOT NULL,
	CONSTRAINT "people_directory_stage_organization_id_run_id_external_id_pk" PRIMARY KEY("organization_id","run_id","external_id")
);
--> statement-breakpoint
CREATE TABLE "people_directory_sync" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"source_target" text NOT NULL,
	"client_id" text,
	"encrypted_credential" text,
	"configured_by" text,
	"lease_token" text,
	"lease_expires_at" timestamp,
	"run_id" text,
	"run_started_at" timestamp,
	"phase" text,
	"cursor" text,
	"users_read" integer DEFAULT 0 NOT NULL,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"next_sync_at" timestamp DEFAULT now() NOT NULL,
	"last_attempt_at" timestamp,
	"last_success_at" timestamp,
	"last_failed_at" timestamp,
	"last_error" text
);
--> statement-breakpoint
ALTER TABLE "people_directory_entry" ADD CONSTRAINT "people_directory_entry_organization_id_people_directory_sync_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."people_directory_sync"("organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people_directory_page" ADD CONSTRAINT "people_directory_page_organization_id_people_directory_sync_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."people_directory_sync"("organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people_directory_stage" ADD CONSTRAINT "people_directory_stage_organization_id_people_directory_sync_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."people_directory_sync"("organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people_directory_sync" ADD CONSTRAINT "people_directory_sync_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people_directory_sync" ADD CONSTRAINT "people_directory_sync_configured_by_user_id_fk" FOREIGN KEY ("configured_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "people_directory_entry_source_id_idx" ON "people_directory_entry" USING btree ("organization_id","external_id");--> statement-breakpoint
CREATE INDEX "people_directory_entry_email_idx" ON "people_directory_entry" USING btree ("organization_id","email");--> statement-breakpoint
CREATE INDEX "people_directory_entry_manager_idx" ON "people_directory_entry" USING btree ("organization_id","manager_external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "people_directory_stage_email_idx" ON "people_directory_stage" USING btree ("organization_id","run_id","email");--> statement-breakpoint
CREATE INDEX "people_directory_stage_pending_idx" ON "people_directory_stage" USING btree ("organization_id","run_id","external_id") WHERE NOT "people_directory_stage"."reports_complete";--> statement-breakpoint
CREATE INDEX "people_directory_sync_due_idx" ON "people_directory_sync" USING btree ("next_sync_at");