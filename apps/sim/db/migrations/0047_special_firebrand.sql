DROP INDEX "memory_workflow_key_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "memory_workflow_key_active_idx" ON "memory" USING btree ("workflow_id","key") WHERE "memory"."deleted_at" is null;