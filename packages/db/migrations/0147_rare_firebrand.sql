DROP INDEX "idempotency_key_namespace_unique";--> statement-breakpoint
DROP INDEX "idempotency_key_namespace_idx";--> statement-breakpoint
ALTER TABLE "idempotency_key" ADD PRIMARY KEY ("key");--> statement-breakpoint
ALTER TABLE "idempotency_key" DROP COLUMN "namespace";