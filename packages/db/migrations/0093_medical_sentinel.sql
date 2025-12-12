DROP INDEX "workflow_blocks_parent_id_idx";--> statement-breakpoint
DROP INDEX "workflow_blocks_workflow_parent_idx";--> statement-breakpoint
ALTER TABLE "workflow_blocks" DROP COLUMN "parent_id";--> statement-breakpoint
ALTER TABLE "workflow_blocks" DROP COLUMN "extent";