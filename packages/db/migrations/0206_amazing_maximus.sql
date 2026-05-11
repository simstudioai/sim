ALTER TABLE "settings" ALTER COLUMN "mothership_environment" SET DEFAULT 'default';
--> statement-breakpoint
UPDATE "settings" SET "mothership_environment" = 'default' WHERE "mothership_environment" = 'prod';