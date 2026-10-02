CREATE TABLE "workspace_fork_workflow_sync" (
	"deployment_operation_id" text PRIMARY KEY NOT NULL,
	"child_workspace_id" text NOT NULL,
	"source_workflow_id" text NOT NULL,
	"target_workflow_id" text NOT NULL,
	"source_deployment_version_id" text NOT NULL,
	"sequence" bigint GENERATED ALWAYS AS IDENTITY (sequence name "workspace_fork_workflow_sync_sequence_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"promote_run_id" text NOT NULL,
	"activated_at" timestamp,
	"rollback_operation_id" text,
	"rolled_back_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "workspace_fork_workflow_sync" ADD CONSTRAINT "workspace_fork_workflow_sync_child_workspace_id_workspace_id_fk" FOREIGN KEY ("child_workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_fork_workflow_sync" ADD CONSTRAINT "workspace_fork_workflow_sync_source_workflow_id_workflow_id_fk" FOREIGN KEY ("source_workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_fork_workflow_sync" ADD CONSTRAINT "workspace_fork_workflow_sync_target_workflow_id_workflow_id_fk" FOREIGN KEY ("target_workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workspace_fork_workflow_sync_baseline_idx" ON "workspace_fork_workflow_sync" USING btree ("child_workspace_id","source_workflow_id","target_workflow_id","sequence" DESC NULLS LAST) WHERE "workspace_fork_workflow_sync"."activated_at" IS NOT NULL AND "workspace_fork_workflow_sync"."rolled_back_at" IS NULL;--> statement-breakpoint
CREATE INDEX "workspace_fork_workflow_sync_run_idx" ON "workspace_fork_workflow_sync" USING btree ("promote_run_id","target_workflow_id");--> statement-breakpoint
CREATE INDEX "workspace_fork_workflow_sync_rollback_idx" ON "workspace_fork_workflow_sync" USING btree ("rollback_operation_id") WHERE "workspace_fork_workflow_sync"."rollback_operation_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "workspace_fork_workflow_sync_source_idx" ON "workspace_fork_workflow_sync" USING btree ("source_workflow_id");--> statement-breakpoint
CREATE INDEX "workspace_fork_workflow_sync_target_idx" ON "workspace_fork_workflow_sync" USING btree ("target_workflow_id");--> statement-breakpoint
CREATE INDEX "workspace_fork_workflow_sync_child_workspace_idx" ON "workspace_fork_workflow_sync" USING btree ("child_workspace_id");
