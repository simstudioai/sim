CREATE TABLE "copilot_request_stops" (
	"user_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"stream_id" text NOT NULL,
	"stopped_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "copilot_request_stops_user_id_workspace_id_stream_id_pk" PRIMARY KEY("user_id","workspace_id","stream_id")
);
--> statement-breakpoint
CREATE TABLE "copilot_task_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"execution_id" text NOT NULL,
	"chat_id" uuid NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mothership_resource_effects" (
	"chat_id" uuid NOT NULL,
	"effect_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "mothership_resource_effects_chat_id_effect_id_pk" PRIMARY KEY("chat_id","effect_id")
);
--> statement-breakpoint
ALTER TABLE "copilot_async_tool_calls" ADD COLUMN "execution_started_at" timestamp;--> statement-breakpoint
ALTER TABLE "copilot_async_tool_calls" ADD COLUMN "execution_settled_at" timestamp;--> statement-breakpoint
ALTER TABLE "copilot_async_tool_calls" ADD COLUMN "execution_owner_token" text;--> statement-breakpoint
ALTER TABLE "copilot_async_tool_calls" ADD COLUMN "execution_lease_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "copilot_async_tool_calls" ADD COLUMN "execution_revoked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "copilot_async_tool_calls" ADD COLUMN "client_workflow_execution_id" text;--> statement-breakpoint
ALTER TABLE "copilot_async_tool_calls" ADD COLUMN "sandbox_processes" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "copilot_runs" ADD COLUMN "tool_execution_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "copilot_runs" ADD COLUMN "tool_admission_closed_at" timestamp;--> statement-breakpoint
ALTER TABLE "copilot_request_stops" ADD CONSTRAINT "copilot_request_stops_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copilot_request_stops" ADD CONSTRAINT "copilot_request_stops_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copilot_task_subscriptions" ADD CONSTRAINT "copilot_task_subscriptions_chat_id_copilot_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."copilot_chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copilot_task_subscriptions" ADD CONSTRAINT "copilot_task_subscriptions_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copilot_task_subscriptions" ADD CONSTRAINT "copilot_task_subscriptions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mothership_resource_effects" ADD CONSTRAINT "mothership_resource_effects_chat_id_copilot_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."copilot_chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "copilot_task_subscriptions_execution_idx" ON "copilot_task_subscriptions" USING btree ("execution_id");--> statement-breakpoint
CREATE UNIQUE INDEX "copilot_task_subscriptions_task_idx" ON "copilot_task_subscriptions" USING btree ("task_id");