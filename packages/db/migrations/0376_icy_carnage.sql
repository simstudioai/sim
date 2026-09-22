CREATE TABLE "copilot_service_usage" (
	"id" uuid PRIMARY KEY NOT NULL,
	"stream_id" uuid NOT NULL,
	"tool_call_id" text NOT NULL,
	"service" text NOT NULL,
	"cost_usd" numeric(12, 8) NOT NULL,
	"worker_origin" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"delivered_at" timestamp with time zone,
	"last_error" text
);
--> statement-breakpoint
CREATE INDEX "copilot_service_usage_pending_idx" ON "copilot_service_usage" USING btree ("next_attempt_at") WHERE delivered_at IS NULL;