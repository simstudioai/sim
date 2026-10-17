CREATE TABLE "copilot_run_stops" (
	"user_id" text NOT NULL,
	"stream_id" text NOT NULL,
	"stopped_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "copilot_run_stops_user_id_stream_id_pk" PRIMARY KEY("user_id","stream_id")
);
--> statement-breakpoint
-- migration-safe: retain original source IDs for existing readers; current target authorization loads active resources, and chat/user/organization cascades remain.
ALTER TABLE "copilot_runs" DROP CONSTRAINT "copilot_runs_workflow_id_workflow_id_fk";
--> statement-breakpoint
-- migration-safe: retain original source IDs and indexes for old runs and Stop readers; source deletion must not cascade retained execution history.
ALTER TABLE "copilot_runs" DROP CONSTRAINT "copilot_runs_workspace_id_workspace_id_fk";
--> statement-breakpoint
ALTER TABLE "copilot_run_stops" ADD CONSTRAINT "copilot_run_stops_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
