ALTER TABLE "workflow_folder" ADD COLUMN "archived_at" timestamp;--> statement-breakpoint
CREATE INDEX "workflow_folder_archived_at_idx" ON "workflow_folder" USING btree ("archived_at");