CREATE TYPE "public"."permission_type" AS ENUM('admin', 'write', 'read');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "persona" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"photo" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "persona_connection" (
	"id" text PRIMARY KEY NOT NULL,
	"persona_id" text NOT NULL,
	"connected_persona_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "persona_workflow" (
	"id" text PRIMARY KEY NOT NULL,
	"persona_id" text NOT NULL,
	"workflow_id" text NOT NULL,
	"status" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_key" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"key" text NOT NULL,
	"last_used" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp,
	CONSTRAINT "api_key_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "chat" (
	"id" text PRIMARY KEY NOT NULL,
	"workflow_id" text NOT NULL,
	"user_id" text NOT NULL,
	"subdomain" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"customizations" json DEFAULT '{}',
	"auth_type" text DEFAULT 'public' NOT NULL,
	"password" text,
	"allowed_emails" json DEFAULT '[]',
	"output_configs" json DEFAULT '[]',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "custom_tools" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"schema" json NOT NULL,
	"code" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document" (
	"id" text PRIMARY KEY NOT NULL,
	"knowledge_base_id" text NOT NULL,
	"filename" text NOT NULL,
	"file_url" text NOT NULL,
	"file_size" integer NOT NULL,
	"mime_type" text NOT NULL,
	"chunk_count" integer DEFAULT 0 NOT NULL,
	"token_count" integer DEFAULT 0 NOT NULL,
	"character_count" integer DEFAULT 0 NOT NULL,
	"processing_status" text DEFAULT 'pending' NOT NULL,
	"processing_started_at" timestamp,
	"processing_completed_at" timestamp,
	"processing_error" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp,
	"uploaded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "embedding" (
	"id" text PRIMARY KEY NOT NULL,
	"knowledge_base_id" text NOT NULL,
	"document_id" text NOT NULL,
	"chunk_index" integer NOT NULL,
	"chunk_hash" text NOT NULL,
	"content" text NOT NULL,
	"content_length" integer NOT NULL,
	"token_count" integer NOT NULL,
	"embedding" vector(1536),
	"embedding_model" text DEFAULT 'text-embedding-3-small' NOT NULL,
	"start_offset" integer NOT NULL,
	"end_offset" integer NOT NULL,
	"metadata" jsonb DEFAULT '{}' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"content_tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', "embedding"."content")) STORED,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "embedding_not_null_check" CHECK ("embedding" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "environment" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"variables" json NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "environment_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"inviter_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"role" text NOT NULL,
	"status" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_base" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"name" text NOT NULL,
	"description" text,
	"token_count" integer DEFAULT 0 NOT NULL,
	"embedding_model" text DEFAULT 'text-embedding-3-small' NOT NULL,
	"embedding_dimension" integer DEFAULT 1536 NOT NULL,
	"chunking_config" json DEFAULT '{"maxSize": 1024, "minSize": 100, "overlap": 200}' NOT NULL,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketplace" (
	"id" text PRIMARY KEY NOT NULL,
	"workflow_id" text NOT NULL,
	"state" json NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"author_id" text NOT NULL,
	"author_name" text NOT NULL,
	"views" integer DEFAULT 0 NOT NULL,
	"category" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memory" (
	"id" text PRIMARY KEY NOT NULL,
	"workflow_id" text,
	"key" text NOT NULL,
	"type" text NOT NULL,
	"data" json NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo" text,
	"metadata" json,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"permission_type" "permission_type" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"active_organization_id" text,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"theme" text DEFAULT 'system' NOT NULL,
	"debug_mode" boolean DEFAULT false NOT NULL,
	"auto_connect" boolean DEFAULT true NOT NULL,
	"auto_fill_env_vars" boolean DEFAULT true NOT NULL,
	"auto_pan" boolean DEFAULT true NOT NULL,
	"telemetry_enabled" boolean DEFAULT true NOT NULL,
	"telemetry_notified_user" boolean DEFAULT false NOT NULL,
	"email_preferences" json DEFAULT '{}' NOT NULL,
	"general" json DEFAULT '{}' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "settings_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "subscription" (
	"id" text PRIMARY KEY NOT NULL,
	"plan" text NOT NULL,
	"reference_id" text NOT NULL,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"status" text,
	"period_start" timestamp,
	"period_end" timestamp,
	"cancel_at_period_end" boolean,
	"seats" integer,
	"trial_start" timestamp,
	"trial_end" timestamp,
	"metadata" json,
	CONSTRAINT "check_enterprise_metadata" CHECK (plan != 'enterprise' OR (metadata IS NOT NULL AND (metadata->>'perSeatAllowance' IS NOT NULL OR metadata->>'totalAllowance' IS NOT NULL)))
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean NOT NULL,
	"image" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"stripe_customer_id" text,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "user_stats" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"total_manual_executions" integer DEFAULT 0 NOT NULL,
	"total_api_calls" integer DEFAULT 0 NOT NULL,
	"total_webhook_triggers" integer DEFAULT 0 NOT NULL,
	"total_scheduled_executions" integer DEFAULT 0 NOT NULL,
	"total_chat_executions" integer DEFAULT 0 NOT NULL,
	"total_tokens_used" integer DEFAULT 0 NOT NULL,
	"total_cost" numeric DEFAULT '0' NOT NULL,
	"current_usage_limit" numeric DEFAULT '5' NOT NULL,
	"usage_limit_set_by" text,
	"usage_limit_updated_at" timestamp DEFAULT now(),
	"current_period_cost" numeric DEFAULT '0' NOT NULL,
	"billing_period_start" timestamp DEFAULT now(),
	"billing_period_end" timestamp,
	"last_period_cost" numeric DEFAULT '0',
	"last_active" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_stats_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp,
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "waitlist" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "waitlist_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "webhook" (
	"id" text PRIMARY KEY NOT NULL,
	"workflow_id" text NOT NULL,
	"path" text NOT NULL,
	"provider" text,
	"provider_config" json,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"folder_id" text,
	"name" text NOT NULL,
	"description" text,
	"state" json NOT NULL,
	"color" text DEFAULT '#3972F6' NOT NULL,
	"last_synced" timestamp NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"is_deployed" boolean DEFAULT false NOT NULL,
	"deployed_state" json,
	"deployed_at" timestamp,
	"collaborators" json DEFAULT '[]' NOT NULL,
	"run_count" integer DEFAULT 0 NOT NULL,
	"last_run_at" timestamp,
	"variables" json DEFAULT '{}',
	"is_published" boolean DEFAULT false NOT NULL,
	"marketplace_data" json
);
--> statement-breakpoint
CREATE TABLE "workflow_blocks" (
	"id" text PRIMARY KEY NOT NULL,
	"workflow_id" text NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"position_x" numeric NOT NULL,
	"position_y" numeric NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"horizontal_handles" boolean DEFAULT true NOT NULL,
	"is_wide" boolean DEFAULT false NOT NULL,
	"advanced_mode" boolean DEFAULT false NOT NULL,
	"height" numeric DEFAULT '0' NOT NULL,
	"sub_blocks" jsonb DEFAULT '{}' NOT NULL,
	"outputs" jsonb DEFAULT '{}' NOT NULL,
	"data" jsonb DEFAULT '{}',
	"parent_id" text,
	"extent" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_edges" (
	"id" text PRIMARY KEY NOT NULL,
	"workflow_id" text NOT NULL,
	"source_block_id" text NOT NULL,
	"target_block_id" text NOT NULL,
	"source_handle" text,
	"target_handle" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_execution_blocks" (
	"id" text PRIMARY KEY NOT NULL,
	"execution_id" text NOT NULL,
	"workflow_id" text NOT NULL,
	"block_id" text NOT NULL,
	"block_name" text,
	"block_type" text NOT NULL,
	"started_at" timestamp NOT NULL,
	"ended_at" timestamp,
	"duration_ms" integer,
	"status" text NOT NULL,
	"error_message" text,
	"error_stack_trace" text,
	"input_data" jsonb,
	"output_data" jsonb,
	"cost_input" numeric(10, 6),
	"cost_output" numeric(10, 6),
	"cost_total" numeric(10, 6),
	"tokens_prompt" integer,
	"tokens_completion" integer,
	"tokens_total" integer,
	"model_used" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_execution_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"workflow_id" text NOT NULL,
	"execution_id" text NOT NULL,
	"state_snapshot_id" text NOT NULL,
	"level" text NOT NULL,
	"message" text NOT NULL,
	"trigger" text NOT NULL,
	"started_at" timestamp NOT NULL,
	"ended_at" timestamp,
	"total_duration_ms" integer,
	"block_count" integer DEFAULT 0 NOT NULL,
	"success_count" integer DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"skipped_count" integer DEFAULT 0 NOT NULL,
	"total_cost" numeric(10, 6),
	"total_input_cost" numeric(10, 6),
	"total_output_cost" numeric(10, 6),
	"total_tokens" integer,
	"metadata" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_execution_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"workflow_id" text NOT NULL,
	"state_hash" text NOT NULL,
	"state_data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_folder" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"parent_id" text,
	"color" text DEFAULT '#6B7280',
	"is_expanded" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"workflow_id" text NOT NULL,
	"execution_id" text,
	"level" text NOT NULL,
	"message" text NOT NULL,
	"duration" text,
	"trigger" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"metadata" json
);
--> statement-breakpoint
CREATE TABLE "workflow_schedule" (
	"id" text PRIMARY KEY NOT NULL,
	"workflow_id" text NOT NULL,
	"cron_expression" text,
	"next_run_at" timestamp,
	"last_ran_at" timestamp,
	"trigger_type" text NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"last_failed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_schedule_workflow_id_unique" UNIQUE("workflow_id")
);
--> statement-breakpoint
CREATE TABLE "workflow_subflows" (
	"id" text PRIMARY KEY NOT NULL,
	"workflow_id" text NOT NULL,
	"type" text NOT NULL,
	"config" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"owner_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_invitation" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"email" text NOT NULL,
	"inviter_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"token" text NOT NULL,
	"permissions" "permission_type" DEFAULT 'admin' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_invitation_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "workspace_member" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"joined_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persona_connection" ADD CONSTRAINT "persona_connection_persona_id_persona_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."persona"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persona_connection" ADD CONSTRAINT "persona_connection_connected_persona_id_persona_id_fk" FOREIGN KEY ("connected_persona_id") REFERENCES "public"."persona"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persona_workflow" ADD CONSTRAINT "persona_workflow_persona_id_persona_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."persona"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_key" ADD CONSTRAINT "api_key_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat" ADD CONSTRAINT "chat_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat" ADD CONSTRAINT "chat_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_tools" ADD CONSTRAINT "custom_tools_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_knowledge_base_id_knowledge_base_id_fk" FOREIGN KEY ("knowledge_base_id") REFERENCES "public"."knowledge_base"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "embedding" ADD CONSTRAINT "embedding_knowledge_base_id_knowledge_base_id_fk" FOREIGN KEY ("knowledge_base_id") REFERENCES "public"."knowledge_base"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "embedding" ADD CONSTRAINT "embedding_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environment" ADD CONSTRAINT "environment_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviter_id_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_base" ADD CONSTRAINT "knowledge_base_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_base" ADD CONSTRAINT "knowledge_base_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace" ADD CONSTRAINT "marketplace_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace" ADD CONSTRAINT "marketplace_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory" ADD CONSTRAINT "memory_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permissions" ADD CONSTRAINT "permissions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_active_organization_id_organization_id_fk" FOREIGN KEY ("active_organization_id") REFERENCES "public"."organization"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_stats" ADD CONSTRAINT "user_stats_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook" ADD CONSTRAINT "webhook_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow" ADD CONSTRAINT "workflow_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow" ADD CONSTRAINT "workflow_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow" ADD CONSTRAINT "workflow_folder_id_workflow_folder_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."workflow_folder"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_blocks" ADD CONSTRAINT "workflow_blocks_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_edges" ADD CONSTRAINT "workflow_edges_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_edges" ADD CONSTRAINT "workflow_edges_source_block_id_workflow_blocks_id_fk" FOREIGN KEY ("source_block_id") REFERENCES "public"."workflow_blocks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_edges" ADD CONSTRAINT "workflow_edges_target_block_id_workflow_blocks_id_fk" FOREIGN KEY ("target_block_id") REFERENCES "public"."workflow_blocks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_execution_blocks" ADD CONSTRAINT "workflow_execution_blocks_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_execution_logs" ADD CONSTRAINT "workflow_execution_logs_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_execution_logs" ADD CONSTRAINT "workflow_execution_logs_state_snapshot_id_workflow_execution_snapshots_id_fk" FOREIGN KEY ("state_snapshot_id") REFERENCES "public"."workflow_execution_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_execution_snapshots" ADD CONSTRAINT "workflow_execution_snapshots_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_folder" ADD CONSTRAINT "workflow_folder_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_folder" ADD CONSTRAINT "workflow_folder_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_logs" ADD CONSTRAINT "workflow_logs_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_schedule" ADD CONSTRAINT "workflow_schedule_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_subflows" ADD CONSTRAINT "workflow_subflows_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace" ADD CONSTRAINT "workspace_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_invitation" ADD CONSTRAINT "workspace_invitation_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_invitation" ADD CONSTRAINT "workspace_invitation_inviter_id_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_member" ADD CONSTRAINT "workspace_member_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_member" ADD CONSTRAINT "workspace_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "subdomain_idx" ON "chat" USING btree ("subdomain");--> statement-breakpoint
CREATE INDEX "doc_kb_id_idx" ON "document" USING btree ("knowledge_base_id");--> statement-breakpoint
CREATE INDEX "doc_filename_idx" ON "document" USING btree ("filename");--> statement-breakpoint
CREATE INDEX "doc_kb_uploaded_at_idx" ON "document" USING btree ("knowledge_base_id","uploaded_at");--> statement-breakpoint
CREATE INDEX "doc_processing_status_idx" ON "document" USING btree ("knowledge_base_id","processing_status");--> statement-breakpoint
CREATE INDEX "emb_kb_id_idx" ON "embedding" USING btree ("knowledge_base_id");--> statement-breakpoint
CREATE INDEX "emb_doc_id_idx" ON "embedding" USING btree ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "emb_doc_chunk_idx" ON "embedding" USING btree ("document_id","chunk_index");--> statement-breakpoint
CREATE INDEX "emb_kb_model_idx" ON "embedding" USING btree ("knowledge_base_id","embedding_model");--> statement-breakpoint
CREATE INDEX "emb_kb_enabled_idx" ON "embedding" USING btree ("knowledge_base_id","enabled");--> statement-breakpoint
CREATE INDEX "emb_doc_enabled_idx" ON "embedding" USING btree ("document_id","enabled");--> statement-breakpoint
CREATE INDEX "embedding_vector_hnsw_idx" ON "embedding" USING hnsw ("embedding" vector_cosine_ops) WITH (m=16,ef_construction=64);--> statement-breakpoint
CREATE INDEX "emb_metadata_gin_idx" ON "embedding" USING gin ("metadata");--> statement-breakpoint
CREATE INDEX "emb_content_fts_idx" ON "embedding" USING gin ("content_tsv");--> statement-breakpoint
CREATE INDEX "kb_user_id_idx" ON "knowledge_base" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "kb_workspace_id_idx" ON "knowledge_base" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "kb_user_workspace_idx" ON "knowledge_base" USING btree ("user_id","workspace_id");--> statement-breakpoint
CREATE INDEX "kb_deleted_at_idx" ON "knowledge_base" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "memory_key_idx" ON "memory" USING btree ("key");--> statement-breakpoint
CREATE INDEX "memory_workflow_idx" ON "memory" USING btree ("workflow_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memory_workflow_key_idx" ON "memory" USING btree ("workflow_id","key");--> statement-breakpoint
CREATE INDEX "permissions_user_id_idx" ON "permissions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "permissions_entity_idx" ON "permissions" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "permissions_user_entity_type_idx" ON "permissions" USING btree ("user_id","entity_type");--> statement-breakpoint
CREATE INDEX "permissions_user_entity_permission_idx" ON "permissions" USING btree ("user_id","entity_type","permission_type");--> statement-breakpoint
CREATE INDEX "permissions_user_entity_idx" ON "permissions" USING btree ("user_id","entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "permissions_unique_constraint" ON "permissions" USING btree ("user_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "subscription_reference_status_idx" ON "subscription" USING btree ("reference_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "path_idx" ON "webhook" USING btree ("path");--> statement-breakpoint
CREATE INDEX "workflow_blocks_workflow_id_idx" ON "workflow_blocks" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "workflow_blocks_parent_id_idx" ON "workflow_blocks" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "workflow_blocks_workflow_parent_idx" ON "workflow_blocks" USING btree ("workflow_id","parent_id");--> statement-breakpoint
CREATE INDEX "workflow_blocks_workflow_type_idx" ON "workflow_blocks" USING btree ("workflow_id","type");--> statement-breakpoint
CREATE INDEX "workflow_edges_workflow_id_idx" ON "workflow_edges" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "workflow_edges_source_block_idx" ON "workflow_edges" USING btree ("source_block_id");--> statement-breakpoint
CREATE INDEX "workflow_edges_target_block_idx" ON "workflow_edges" USING btree ("target_block_id");--> statement-breakpoint
CREATE INDEX "workflow_edges_workflow_source_idx" ON "workflow_edges" USING btree ("workflow_id","source_block_id");--> statement-breakpoint
CREATE INDEX "workflow_edges_workflow_target_idx" ON "workflow_edges" USING btree ("workflow_id","target_block_id");--> statement-breakpoint
CREATE INDEX "execution_blocks_execution_id_idx" ON "workflow_execution_blocks" USING btree ("execution_id");--> statement-breakpoint
CREATE INDEX "execution_blocks_workflow_id_idx" ON "workflow_execution_blocks" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "execution_blocks_block_id_idx" ON "workflow_execution_blocks" USING btree ("block_id");--> statement-breakpoint
CREATE INDEX "execution_blocks_status_idx" ON "workflow_execution_blocks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "execution_blocks_duration_idx" ON "workflow_execution_blocks" USING btree ("duration_ms");--> statement-breakpoint
CREATE INDEX "execution_blocks_cost_idx" ON "workflow_execution_blocks" USING btree ("cost_total");--> statement-breakpoint
CREATE INDEX "execution_blocks_workflow_execution_idx" ON "workflow_execution_blocks" USING btree ("workflow_id","execution_id");--> statement-breakpoint
CREATE INDEX "execution_blocks_execution_status_idx" ON "workflow_execution_blocks" USING btree ("execution_id","status");--> statement-breakpoint
CREATE INDEX "execution_blocks_started_at_idx" ON "workflow_execution_blocks" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "workflow_execution_logs_workflow_id_idx" ON "workflow_execution_logs" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "workflow_execution_logs_execution_id_idx" ON "workflow_execution_logs" USING btree ("execution_id");--> statement-breakpoint
CREATE INDEX "workflow_execution_logs_trigger_idx" ON "workflow_execution_logs" USING btree ("trigger");--> statement-breakpoint
CREATE INDEX "workflow_execution_logs_level_idx" ON "workflow_execution_logs" USING btree ("level");--> statement-breakpoint
CREATE INDEX "workflow_execution_logs_started_at_idx" ON "workflow_execution_logs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "workflow_execution_logs_cost_idx" ON "workflow_execution_logs" USING btree ("total_cost");--> statement-breakpoint
CREATE INDEX "workflow_execution_logs_duration_idx" ON "workflow_execution_logs" USING btree ("total_duration_ms");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_execution_logs_execution_id_unique" ON "workflow_execution_logs" USING btree ("execution_id");--> statement-breakpoint
CREATE INDEX "workflow_snapshots_workflow_id_idx" ON "workflow_execution_snapshots" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "workflow_snapshots_hash_idx" ON "workflow_execution_snapshots" USING btree ("state_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_snapshots_workflow_hash_idx" ON "workflow_execution_snapshots" USING btree ("workflow_id","state_hash");--> statement-breakpoint
CREATE INDEX "workflow_snapshots_created_at_idx" ON "workflow_execution_snapshots" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "workflow_folder_user_idx" ON "workflow_folder" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "workflow_folder_workspace_parent_idx" ON "workflow_folder" USING btree ("workspace_id","parent_id");--> statement-breakpoint
CREATE INDEX "workflow_folder_parent_sort_idx" ON "workflow_folder" USING btree ("parent_id","sort_order");--> statement-breakpoint
CREATE INDEX "workflow_subflows_workflow_id_idx" ON "workflow_subflows" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "workflow_subflows_workflow_type_idx" ON "workflow_subflows" USING btree ("workflow_id","type");--> statement-breakpoint
CREATE UNIQUE INDEX "user_workspace_idx" ON "workspace_member" USING btree ("user_id","workspace_id");