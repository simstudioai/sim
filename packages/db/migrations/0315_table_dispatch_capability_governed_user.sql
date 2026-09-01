-- Adds the permission-group subject a table run's cells are gated against, separate from
-- `triggered_by_user_id` (an attribution that substitutes the workspace billed account when the
-- credential names no human). Purely additive and nullable: every existing row reads NULL, which
-- means "no acting person, no per-tool gate" — the same answer those runs already get today.
ALTER TABLE "table_run_dispatches" ADD COLUMN "capability_governed_user_id" text;--> statement-breakpoint
ALTER TABLE "table_run_dispatches" ADD CONSTRAINT "table_run_dispatches_capability_governed_user_id_user_id_fk" FOREIGN KEY ("capability_governed_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "table_run_dispatches" VALIDATE CONSTRAINT "table_run_dispatches_capability_governed_user_id_user_id_fk";
