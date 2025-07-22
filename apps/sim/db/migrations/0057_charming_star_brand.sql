ALTER TABLE "workflow_schedule" DROP CONSTRAINT "workflow_schedule_workflow_id_unique";--> statement-breakpoint
ALTER TABLE "webhook" ADD COLUMN "block_id" text;--> statement-breakpoint
ALTER TABLE "workflow_schedule" ADD COLUMN "block_id" text;--> statement-breakpoint
ALTER TABLE "webhook" ADD CONSTRAINT "webhook_block_id_workflow_blocks_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."workflow_blocks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_schedule" ADD CONSTRAINT "workflow_schedule_block_id_workflow_blocks_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."workflow_blocks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_schedule_workflow_block_unique" ON "workflow_schedule" USING btree ("workflow_id","block_id");