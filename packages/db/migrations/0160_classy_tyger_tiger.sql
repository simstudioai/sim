DROP INDEX "a2a_agent_workspace_id_idx";--> statement-breakpoint
DROP INDEX "a2a_push_notification_config_task_id_idx";--> statement-breakpoint
DROP INDEX "credential_member_credential_id_idx";--> statement-breakpoint
DROP INDEX "credential_set_organization_id_idx";--> statement-breakpoint
DROP INDEX "credential_set_member_set_id_idx";--> statement-breakpoint
DROP INDEX "permission_group_organization_id_idx";--> statement-breakpoint
DROP INDEX "skill_workspace_id_idx";--> statement-breakpoint
DROP INDEX "user_table_rows_workspace_id_idx";--> statement-breakpoint
CREATE INDEX "workflow_execution_logs_running_started_at_idx" ON "workflow_execution_logs" USING btree ("started_at") WHERE status = 'running';