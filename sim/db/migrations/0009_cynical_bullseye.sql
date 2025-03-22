ALTER TABLE "workflow" ADD COLUMN "is_deployed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow" ADD COLUMN "deployed_at" timestamp;--> statement-breakpoint
ALTER TABLE "workflow" ADD COLUMN "api_key" text;