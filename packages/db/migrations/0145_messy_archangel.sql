ALTER TABLE "webhook" DROP CONSTRAINT "webhook_block_id_workflow_blocks_id_fk";
--> statement-breakpoint
ALTER TABLE "workflow_schedule" DROP CONSTRAINT "workflow_schedule_block_id_workflow_blocks_id_fk";
--> statement-breakpoint
DROP INDEX "path_idx";--> statement-breakpoint
DROP INDEX "workflow_schedule_workflow_block_unique";--> statement-breakpoint
ALTER TABLE "webhook" ADD COLUMN "deployment_version_id" text;--> statement-breakpoint
ALTER TABLE "workflow_schedule" ADD COLUMN "deployment_version_id" text;--> statement-breakpoint
ALTER TABLE "webhook" ADD CONSTRAINT "webhook_deployment_version_id_workflow_deployment_version_id_fk" FOREIGN KEY ("deployment_version_id") REFERENCES "public"."workflow_deployment_version"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_schedule" ADD CONSTRAINT "workflow_schedule_deployment_version_id_workflow_deployment_version_id_fk" FOREIGN KEY ("deployment_version_id") REFERENCES "public"."workflow_deployment_version"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "path_deployment_unique" ON "webhook" USING btree ("path","deployment_version_id");--> statement-breakpoint
CREATE INDEX "webhook_workflow_deployment_idx" ON "webhook" USING btree ("workflow_id","deployment_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_schedule_workflow_block_deployment_unique" ON "workflow_schedule" USING btree ("workflow_id","block_id","deployment_version_id");--> statement-breakpoint
CREATE INDEX "workflow_schedule_workflow_deployment_idx" ON "workflow_schedule" USING btree ("workflow_id","deployment_version_id");--> statement-breakpoint
UPDATE "webhook" AS w
SET "deployment_version_id" = dv."id"
FROM "workflow_deployment_version" AS dv
WHERE dv."workflow_id" = w."workflow_id"
  AND dv."is_active" = true
  AND w."deployment_version_id" IS NULL;--> statement-breakpoint
UPDATE "workflow_schedule" AS ws
SET "deployment_version_id" = dv."id"
FROM "workflow_deployment_version" AS dv
WHERE dv."workflow_id" = ws."workflow_id"
  AND dv."is_active" = true
  AND ws."deployment_version_id" IS NULL;