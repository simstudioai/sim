CREATE TABLE "onprem_deployment" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"api_key_hash" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "onprem_deployment_api_key_hash_unique" UNIQUE("api_key_hash")
);
--> statement-breakpoint
CREATE TABLE "onprem_deployment_rate" (
	"id" text PRIMARY KEY NOT NULL,
	"deployment_id" text NOT NULL,
	"usd_per_credit" numeric(12, 8) NOT NULL,
	"effective_from" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "onprem_usage_report" (
	"id" text PRIMARY KEY NOT NULL,
	"deployment_id" text NOT NULL,
	"period_start" timestamp NOT NULL,
	"period_end" timestamp NOT NULL,
	"workflow_executions" integer DEFAULT 0 NOT NULL,
	"workflow_executions_failed" integer DEFAULT 0 NOT NULL,
	"workflow_duration_ms" bigint DEFAULT 0 NOT NULL,
	"credits" numeric(20, 6) DEFAULT '0' NOT NULL,
	"input_tokens" bigint DEFAULT 0 NOT NULL,
	"output_tokens" bigint DEFAULT 0 NOT NULL,
	"breakdown" jsonb DEFAULT '{}' NOT NULL,
	"schema_version" integer NOT NULL,
	"reported_at" timestamp NOT NULL,
	"received_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "onprem_deployment_rate" ADD CONSTRAINT "onprem_deployment_rate_deployment_id_onprem_deployment_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."onprem_deployment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onprem_usage_report" ADD CONSTRAINT "onprem_usage_report_deployment_id_onprem_deployment_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."onprem_deployment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "onprem_deployment_rate_deployment_effective_idx" ON "onprem_deployment_rate" USING btree ("deployment_id","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "onprem_usage_report_deployment_period_unique" ON "onprem_usage_report" USING btree ("deployment_id","period_start");