ALTER TABLE "workflow_blocks" ALTER COLUMN "position_x" SET DATA TYPE numeric;--> statement-breakpoint
ALTER TABLE "workflow_blocks" ALTER COLUMN "position_y" SET DATA TYPE numeric;--> statement-breakpoint
ALTER TABLE "workflow_blocks" ALTER COLUMN "height" SET DATA TYPE numeric;--> statement-breakpoint
ALTER TABLE "workflow_blocks" ALTER COLUMN "height" SET DEFAULT '0';
