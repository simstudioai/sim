ALTER TABLE "workflow" ADD COLUMN "locked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_folder" ADD COLUMN "locked" boolean DEFAULT false NOT NULL;