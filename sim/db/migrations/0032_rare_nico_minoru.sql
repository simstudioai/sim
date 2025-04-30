ALTER TABLE "chat" ADD COLUMN "output_configs" json DEFAULT '[]';--> statement-breakpoint
ALTER TABLE "chat" DROP COLUMN "output_block_id";--> statement-breakpoint
ALTER TABLE "chat" DROP COLUMN "output_path";