COMMIT;--> statement-breakpoint
SET lock_timeout = 0;--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS "copilot_messages_user_created_at_idx";--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "copilot_messages_user_created_at_idx" ON "copilot_messages" USING btree ("created_at","chat_id","message_id") WHERE "copilot_messages"."role" = 'user' AND "copilot_messages"."deleted_at" IS NULL;--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS "outbox_event_type_created_idx";--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "outbox_event_type_created_idx" ON "outbox_event" USING btree ("event_type","created_at");--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS "workflow_execution_logs_completed_ended_at_idx";--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "workflow_execution_logs_completed_ended_at_idx" ON "workflow_execution_logs" USING btree ("ended_at","workspace_id","execution_id") WHERE "workflow_execution_logs"."status" = 'completed' AND "workflow_execution_logs"."level" = 'info' AND "workflow_execution_logs"."ended_at" IS NOT NULL;--> statement-breakpoint
SET lock_timeout = '5s';