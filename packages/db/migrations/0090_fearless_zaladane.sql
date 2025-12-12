CREATE TABLE "idempotency_key" (
	"key" text NOT NULL,
	"namespace" text DEFAULT 'default' NOT NULL,
	"result" json NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_key_namespace_unique" ON "idempotency_key" USING btree ("key","namespace");--> statement-breakpoint
CREATE INDEX "idempotency_key_created_at_idx" ON "idempotency_key" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idempotency_key_namespace_idx" ON "idempotency_key" USING btree ("namespace");