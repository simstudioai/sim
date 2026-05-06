ALTER TABLE "organization" ADD COLUMN "data_retention_settings" json;--> statement-breakpoint
ALTER TABLE "workspace" DROP COLUMN "log_retention_hours";--> statement-breakpoint
ALTER TABLE "workspace" DROP COLUMN "soft_delete_retention_hours";--> statement-breakpoint
ALTER TABLE "workspace" DROP COLUMN "task_cleanup_hours";