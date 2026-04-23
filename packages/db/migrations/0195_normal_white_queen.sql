ALTER TABLE "api_key" ADD COLUMN "key_hash" text;--> statement-breakpoint
CREATE UNIQUE INDEX "api_key_key_hash_idx" ON "api_key" USING btree ("key_hash");