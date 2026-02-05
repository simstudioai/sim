CREATE TABLE "async_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp,
	"run_at" timestamp,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"error" text,
	"output" jsonb,
	"metadata" jsonb DEFAULT '{}' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "async_jobs_status_started_at_idx" ON "async_jobs" USING btree ("status","started_at");--> statement-breakpoint
CREATE INDEX "async_jobs_status_completed_at_idx" ON "async_jobs" USING btree ("status","completed_at");