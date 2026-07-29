CREATE TABLE "newsletter_audience_recipients" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"user_id" text,
	"email" text NOT NULL,
	"name" text,
	"inclusion_reason" jsonb DEFAULT '{}' NOT NULL,
	"snapshot_version" integer NOT NULL,
	"resend_contact_id" text,
	"resend_status" text DEFAULT 'pending' NOT NULL,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "newsletter_audience_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"created_by_id" text,
	"name" text NOT NULL,
	"prompt" text NOT NULL,
	"criteria" jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"total_matched" integer DEFAULT 0 NOT NULL,
	"excluded_banned" integer DEFAULT 0 NOT NULL,
	"excluded_unverified" integer DEFAULT 0 NOT NULL,
	"excluded_unsubscribed" integer DEFAULT 0 NOT NULL,
	"excluded_suppressed" integer DEFAULT 0 NOT NULL,
	"final_recipient_count" integer DEFAULT 0 NOT NULL,
	"sample_recipients" jsonb DEFAULT '[]' NOT NULL,
	"resend_segment_id" text,
	"resend_segment_name" text,
	"resend_synced_at" timestamp,
	"snapshot_version" integer DEFAULT 0 NOT NULL,
	"resend_sync_attempt" integer DEFAULT 0 NOT NULL,
	"resend_sync_job_id" text,
	"error" text,
	"finalized_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "newsletter_audience_recipients" ADD CONSTRAINT "newsletter_audience_recipients_run_id_newsletter_audience_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."newsletter_audience_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_audience_recipients" ADD CONSTRAINT "newsletter_audience_recipients_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_audience_runs" ADD CONSTRAINT "newsletter_audience_runs_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "newsletter_audience_recipients_run_id_idx" ON "newsletter_audience_recipients" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "newsletter_audience_recipients_user_id_idx" ON "newsletter_audience_recipients" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "newsletter_audience_recipients_email_idx" ON "newsletter_audience_recipients" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "newsletter_audience_recipients_run_version_email_unique" ON "newsletter_audience_recipients" USING btree ("run_id","snapshot_version","email");--> statement-breakpoint
CREATE INDEX "newsletter_audience_recipients_resend_status_email_idx" ON "newsletter_audience_recipients" USING btree ("run_id","resend_status","email");--> statement-breakpoint
CREATE INDEX "newsletter_audience_runs_created_at_idx" ON "newsletter_audience_runs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "newsletter_audience_runs_created_by_idx" ON "newsletter_audience_runs" USING btree ("created_by_id");--> statement-breakpoint
CREATE INDEX "newsletter_audience_runs_status_idx" ON "newsletter_audience_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "newsletter_audience_runs_resend_sync_job_idx" ON "newsletter_audience_runs" USING btree ("resend_sync_job_id");