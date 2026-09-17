CREATE TABLE "knowledge_connector_partition" (
	"connector_id" text NOT NULL,
	"partition_key" text NOT NULL,
	"generation_id" text NOT NULL,
	"context" jsonb NOT NULL,
	"cursor" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"retry_at" timestamp DEFAULT now() NOT NULL,
	"last_served_at" timestamp,
	"failure" jsonb,
	"permission_cursor" text,
	"permission_attempts" integer DEFAULT 0 NOT NULL,
	"permission_retry_at" timestamp NOT NULL,
	"permission_last_served_at" timestamp,
	"permission_started_at" timestamp,
	"permission_failure" jsonb,
	CONSTRAINT "kcp_pk" PRIMARY KEY("connector_id","partition_key"),
	CONSTRAINT "kcp_partition_key_check" CHECK (octet_length("knowledge_connector_partition"."partition_key") BETWEEN 1 AND 1024),
	CONSTRAINT "kcp_context_check" CHECK (jsonb_typeof("knowledge_connector_partition"."context") = 'object' AND octet_length("knowledge_connector_partition"."context"::text) <= 16384),
	CONSTRAINT "kcp_status_check" CHECK ("knowledge_connector_partition"."status" IN ('pending', 'complete', 'blocked')),
	CONSTRAINT "kcp_cursor_check" CHECK (("knowledge_connector_partition"."cursor" IS NULL OR octet_length("knowledge_connector_partition"."cursor") <= 393216) AND ("knowledge_connector_partition"."permission_cursor" IS NULL OR octet_length("knowledge_connector_partition"."permission_cursor") <= 393216)),
	CONSTRAINT "kcp_attempts_check" CHECK ("knowledge_connector_partition"."attempts" >= 0 AND "knowledge_connector_partition"."permission_attempts" >= 0)
);
--> statement-breakpoint
ALTER TABLE "knowledge_connector_partition" ADD CONSTRAINT "knowledge_connector_partition_connector_id_knowledge_connector_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."knowledge_connector"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kcp_content_due_idx" ON "knowledge_connector_partition" USING btree ("connector_id","generation_id","status","retry_at","last_served_at");--> statement-breakpoint
CREATE INDEX "kcp_permission_due_idx" ON "knowledge_connector_partition" USING btree ("connector_id","generation_id","permission_retry_at","permission_last_served_at");