DROP INDEX "workspace_byok_provider_unique";--> statement-breakpoint
ALTER TABLE "workspace_byok_keys" ADD COLUMN "name" text;--> statement-breakpoint
CREATE INDEX "workspace_byok_workspace_provider_idx" ON "workspace_byok_keys" USING btree ("workspace_id","provider_id");