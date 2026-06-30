-- migration-safe: A2A feature fully removed in this change (block tools, serve/agents API, deploy UI, and all lifecycle/copilot-VFS/cleanup readers of a2a_agent); feature was unused with no production consumers
DROP TABLE "a2a_agent" CASCADE;--> statement-breakpoint
-- migration-safe: a2a_push_notification_config readers removed with the A2A serve API in this change; feature was unused
DROP TABLE "a2a_push_notification_config" CASCADE;--> statement-breakpoint
-- migration-safe: a2a_task readers removed with the A2A serve API in this change; feature was unused
DROP TABLE "a2a_task" CASCADE;--> statement-breakpoint
-- migration-safe: total_a2a_executions was a deprecated, never-written usage counter with no code readers prior to this change
ALTER TABLE "user_stats" DROP COLUMN "total_a2a_executions";--> statement-breakpoint
-- migration-safe: a2a_task_status enum is only referenced by the a2a_task table dropped above
DROP TYPE "public"."a2a_task_status";