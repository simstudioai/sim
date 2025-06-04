ALTER TABLE "marketplace" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "marketplace" CASCADE;--> statement-breakpoint
ALTER TABLE "templates" RENAME COLUMN "source_workflow_id" TO "workflow_id";--> statement-breakpoint
ALTER TABLE "templates" ALTER COLUMN "price" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "templates" ALTER COLUMN "price" SET DEFAULT 'Free';--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "processing_status" text;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "processing_started_at" timestamp;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "processing_completed_at" timestamp;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "processing_error" text;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "templates_category_idx" ON "templates" USING btree ("category");--> statement-breakpoint
CREATE INDEX "templates_views_idx" ON "templates" USING btree ("views");--> statement-breakpoint
CREATE INDEX "templates_created_at_idx" ON "templates" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "templates_author_id_idx" ON "templates" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "templates_category_views_idx" ON "templates" USING btree ("category","views");--> statement-breakpoint
CREATE INDEX "templates_category_created_at_idx" ON "templates" USING btree ("category","created_at");