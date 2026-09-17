CREATE TABLE "knowledge_connector_google_user" (
	"connector_id" text NOT NULL,
	"user_id" text NOT NULL,
	"generation_id" text NOT NULL,
	"email" text NOT NULL,
	"customer_id" text NOT NULL,
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
	CONSTRAINT "kcgu_pk" PRIMARY KEY("connector_id","user_id"),
	CONSTRAINT "kcgu_status_check" CHECK ("knowledge_connector_google_user"."status" IN ('pending', 'complete', 'blocked')),
	CONSTRAINT "kcgu_cursor_check" CHECK (("knowledge_connector_google_user"."cursor" IS NULL OR octet_length("knowledge_connector_google_user"."cursor") <= 393216) AND ("knowledge_connector_google_user"."permission_cursor" IS NULL OR octet_length("knowledge_connector_google_user"."permission_cursor") <= 393216)),
	CONSTRAINT "kcgu_attempts_check" CHECK ("knowledge_connector_google_user"."attempts" >= 0 AND "knowledge_connector_google_user"."permission_attempts" >= 0)
);
--> statement-breakpoint
ALTER TABLE "knowledge_connector_google_user" ADD CONSTRAINT "knowledge_connector_google_user_connector_id_knowledge_connector_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."knowledge_connector"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kcgu_content_due_idx" ON "knowledge_connector_google_user" USING btree ("connector_id","generation_id","status","retry_at","last_served_at");--> statement-breakpoint
CREATE INDEX "kcgu_permission_due_idx" ON "knowledge_connector_google_user" USING btree ("connector_id","generation_id","permission_retry_at","permission_last_served_at");