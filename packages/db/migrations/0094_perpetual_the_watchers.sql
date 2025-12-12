ALTER TABLE "chat" RENAME COLUMN "subdomain" TO "identifier";--> statement-breakpoint
DROP INDEX "subdomain_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "identifier_idx" ON "chat" USING btree ("identifier");