ALTER TABLE "workflow" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "workflow_folder_sort_idx" ON "workflow" USING btree ("folder_id","sort_order");