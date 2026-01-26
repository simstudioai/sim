CREATE TYPE "billing_blocked_reason" AS ENUM('payment_failed', 'dispute');--> statement-breakpoint
CREATE TYPE "notification_delivery_status" AS ENUM('pending', 'in_progress', 'success', 'failed');--> statement-breakpoint
CREATE TYPE "notification_type" AS ENUM('webhook', 'email', 'slack');--> statement-breakpoint
CREATE TYPE "permission_type" AS ENUM('admin', 'write', 'read');--> statement-breakpoint
CREATE TYPE "workspace_invitation_status" AS ENUM('pending', 'accepted', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "a2a_agent" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"workspace_id" varchar(255) NOT NULL,
	"workflow_id" varchar(255) NOT NULL,
	"created_by" varchar(255) NOT NULL,
	"agent_name" text NOT NULL,
	"description" text,
	"protocol" varchar(255) DEFAULT 'a2a' NOT NULL,
	"endpoint_url" varchar(1024) NOT NULL,
	"api_key" text,
	"status" varchar(255) DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "a2a_task" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"workspace_id" varchar(255) NOT NULL,
	"agent_id" varchar(255) NOT NULL,
	"task_type" varchar(255) NOT NULL,
	"input" text NOT NULL,
	"output" text,
	"status" varchar(255) DEFAULT 'pending' NOT NULL,
	"error" text,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "account" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"account_id" varchar(255) NOT NULL,
	"provider_id" varchar(255) NOT NULL,
	"user_id" varchar(255) NOT NULL,
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
CREATE TABLE IF NOT EXISTS "api_key" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"workspace_id" varchar(255),
	"created_by" varchar(255),
	"name" text NOT NULL,
	"key" varchar(1024) NOT NULL,
	"type" varchar(255) DEFAULT 'personal' NOT NULL,
	"last_used" timestamp,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"expires_at" timestamp,
	CONSTRAINT "api_key_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chat" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"workflow_id" varchar(255) NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"identifier" varchar(255) NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"is_active" smallint DEFAULT 1 NOT NULL,
	"customizations" text,
	"auth_type" varchar(255) DEFAULT 'public' NOT NULL,
	"password" text,
	"allowed_emails" text DEFAULT '[]',
	"output_configs" text DEFAULT '[]',
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "copilot_chats" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"workflow_id" varchar(255) NOT NULL,
	"title" text,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "copilot_feedback" (
	"feedback_id" varchar(255) PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"message_id" varchar(255) NOT NULL,
	"rating" integer NOT NULL,
	"feedback_text" text,
	"metadata" text,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "copilot_messages" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"chat_id" varchar(255) NOT NULL,
	"role" varchar(255) NOT NULL,
	"content" text NOT NULL,
	"diff" text,
	"metadata" text,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "credential_set" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"workspace_id" varchar(255) NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"provider_id" varchar(255) NOT NULL,
	"config" text NOT NULL,
	"encrypted_credentials" text,
	"is_active" smallint DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "credential_set_invitation" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"credential_set_id" varchar(255) NOT NULL,
	"email" varchar(255) NOT NULL,
	"inviter_id" varchar(255) NOT NULL,
	"role" varchar(255) DEFAULT 'member' NOT NULL,
	"status" varchar(255) DEFAULT 'pending' NOT NULL,
	"token" varchar(1024) NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "credential_set_invitation_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "credential_set_membership" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"credential_set_id" varchar(255) NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"role" varchar(255) DEFAULT 'member' NOT NULL,
	"status" varchar(255) DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "custom_tools" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"workspace_id" varchar(255),
	"user_id" varchar(255),
	"title" varchar(255) NOT NULL,
	"schema" text NOT NULL,
	"code" text NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "docs_embeddings" (
	"chunk_id" varchar(255) PRIMARY KEY NOT NULL,
	"chunk_text" text NOT NULL,
	"source_document" varchar(255) NOT NULL,
	"source_link" varchar(1024) NOT NULL,
	"header_text" text NOT NULL,
	"header_level" integer NOT NULL,
	"token_count" integer NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"embedding_model" varchar(255) DEFAULT 'text-embedding-3-small' NOT NULL,
	"metadata" text NOT NULL,
	"chunk_text_tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', "docs_embeddings"."chunk_text")) STORED
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "document" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"knowledge_base_id" varchar(255) NOT NULL,
	"filename" text NOT NULL,
	"file_url" varchar(1024) NOT NULL,
	"file_size" integer NOT NULL,
	"mime_type" varchar(255) NOT NULL,
	"chunk_count" integer DEFAULT 0 NOT NULL,
	"token_count" integer DEFAULT 0 NOT NULL,
	"character_count" integer DEFAULT 0 NOT NULL,
	"processing_status" varchar(255) DEFAULT 'pending' NOT NULL,
	"processing_started_at" timestamp,
	"processing_completed_at" timestamp,
	"processing_error" text,
	"enabled" smallint DEFAULT 1 NOT NULL,
	"deleted_at" timestamp,
	"tag1" varchar(255),
	"tag2" varchar(255),
	"tag3" varchar(255),
	"tag4" varchar(255),
	"tag5" varchar(255),
	"tag6" varchar(255),
	"tag7" varchar(255),
	"number1" double precision,
	"number2" double precision,
	"number3" double precision,
	"number4" double precision,
	"number5" double precision,
	"date1" timestamp,
	"date2" timestamp,
	"boolean1" smallint,
	"boolean2" smallint,
	"boolean3" smallint,
	"uploaded_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "embedding" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"knowledge_base_id" varchar(255) NOT NULL,
	"document_id" varchar(255) NOT NULL,
	"chunk_index" integer NOT NULL,
	"chunk_hash" varchar(255) NOT NULL,
	"content" text NOT NULL,
	"content_length" integer NOT NULL,
	"token_count" integer NOT NULL,
	"embedding" vector(1536),
	"embedding_model" varchar(255) DEFAULT 'text-embedding-3-small' NOT NULL,
	"start_offset" integer NOT NULL,
	"end_offset" integer NOT NULL,
	"tag1" varchar(255),
	"tag2" varchar(255),
	"tag3" varchar(255),
	"tag4" varchar(255),
	"tag5" varchar(255),
	"tag6" varchar(255),
	"tag7" varchar(255),
	"number1" double precision,
	"number2" double precision,
	"number3" double precision,
	"number4" double precision,
	"number5" double precision,
	"date1" timestamp,
	"date2" timestamp,
	"boolean1" smallint,
	"boolean2" smallint,
	"boolean3" smallint,
	"enabled" smallint DEFAULT 1 NOT NULL,
	"content_tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', "embedding"."content")) STORED,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "environment" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"variables" text NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "environment_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "form" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"workflow_id" varchar(255) NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"identifier" varchar(255) NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"is_active" smallint DEFAULT 1 NOT NULL,
	"customizations" text,
	"auth_type" varchar(255) DEFAULT 'public' NOT NULL,
	"password" text,
	"allowed_emails" text DEFAULT '[]',
	"show_branding" smallint DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "idempotency_key" (
	"key" varchar(1024) NOT NULL,
	"namespace" varchar(255) DEFAULT 'default' NOT NULL,
	"result" text NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"expires_at" timestamp NOT NULL,
	CONSTRAINT "idempotency_key_namespace_key_pk" PRIMARY KEY("namespace","key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "invitation" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"email" varchar(255) NOT NULL,
	"inviter_id" varchar(255) NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"role" varchar(255) NOT NULL,
	"status" varchar(255) NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "knowledge_base" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"workspace_id" varchar(255),
	"name" text NOT NULL,
	"description" text,
	"token_count" integer DEFAULT 0 NOT NULL,
	"embedding_model" varchar(255) DEFAULT 'text-embedding-3-small' NOT NULL,
	"embedding_dimension" integer DEFAULT 1536 NOT NULL,
	"chunking_config" text NOT NULL,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "knowledge_base_tag_definitions" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"knowledge_base_id" varchar(255) NOT NULL,
	"tag_slot" varchar(255) NOT NULL,
	"display_name" varchar(255) NOT NULL,
	"field_type" varchar(255) DEFAULT 'text' NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mcp_servers" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"workspace_id" varchar(255) NOT NULL,
	"name" text NOT NULL,
	"url" varchar(1024) NOT NULL,
	"icon" text,
	"description" text,
	"status" varchar(255) DEFAULT 'active' NOT NULL,
	"config" text,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "member" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"role" varchar(255) NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "memory" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"workspace_id" varchar(255) NOT NULL,
	"key" varchar(1024) NOT NULL,
	"data" text NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "organization" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" varchar(255) NOT NULL,
	"logo" text,
	"metadata" text,
	"org_usage_limit" numeric,
	"storage_used_bytes" bigint DEFAULT 0 NOT NULL,
	"departed_member_usage" numeric DEFAULT '0' NOT NULL,
	"credit_balance" numeric DEFAULT '0' NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "paused_executions" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"workflow_id" varchar(255) NOT NULL,
	"execution_id" varchar(255) NOT NULL,
	"execution_snapshot" text NOT NULL,
	"pause_points" text NOT NULL,
	"total_pause_count" integer NOT NULL,
	"resumed_count" integer DEFAULT 0 NOT NULL,
	"status" varchar(255) DEFAULT 'paused' NOT NULL,
	"metadata" text DEFAULT '{}' NOT NULL,
	"paused_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"expires_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "permission_group" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"workspace_id" varchar(255) NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"permissions" text DEFAULT '[]' NOT NULL,
	"is_active" smallint DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "permission_group_member" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"group_id" varchar(255) NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "permissions" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"entity_kind" varchar(255) NOT NULL,
	"entity_id" varchar(255) NOT NULL,
	"permission_kind" varchar(255) NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rate_limit_bucket" (
	"key" varchar(1024) PRIMARY KEY NOT NULL,
	"tokens" numeric NOT NULL,
	"last_refill_at" timestamp NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "resume_queue" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"paused_execution_id" varchar(255) NOT NULL,
	"parent_execution_id" varchar(255) NOT NULL,
	"new_execution_id" varchar(255) NOT NULL,
	"context_id" varchar(255) NOT NULL,
	"resume_input" text,
	"status" varchar(255) DEFAULT 'pending' NOT NULL,
	"queued_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"claimed_at" timestamp,
	"completed_at" timestamp,
	"failure_reason" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "session" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" varchar(1024) NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" varchar(255),
	"user_agent" text,
	"user_id" varchar(255) NOT NULL,
	"active_organization_id" varchar(255),
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "settings" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"theme" varchar(255) DEFAULT 'system' NOT NULL,
	"auto_connect" smallint DEFAULT 1 NOT NULL,
	"telemetry_enabled" smallint DEFAULT 1 NOT NULL,
	"email_preferences" text NOT NULL,
	"billing_usage_notifications_enabled" smallint DEFAULT 1 NOT NULL,
	"show_training_controls" smallint DEFAULT 0 NOT NULL,
	"super_user_mode_enabled" smallint DEFAULT 1 NOT NULL,
	"error_notifications_enabled" smallint DEFAULT 1 NOT NULL,
	"snap_to_grid_size" integer DEFAULT 0 NOT NULL,
	"copilot_enabled_models" text NOT NULL,
	"copilot_auto_allowed_tools" text NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "settings_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sso_provider" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"issuer" varchar(1024) NOT NULL,
	"domain" varchar(255) NOT NULL,
	"oidc_config" text,
	"saml_config" text,
	"user_id" varchar(255) NOT NULL,
	"provider_id" varchar(255) NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "subscription" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"plan" varchar(255) NOT NULL,
	"reference_id" varchar(255) NOT NULL,
	"stripe_customer_id" varchar(255),
	"stripe_subscription_id" varchar(255),
	"status" varchar(255),
	"period_start" timestamp,
	"period_end" timestamp,
	"cancel_at_period_end" smallint,
	"seats" integer,
	"trial_start" timestamp,
	"trial_end" timestamp,
	"metadata" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "template_stars" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"template_id" varchar(255) NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "templates" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"workflow_id" varchar(255),
	"name" text NOT NULL,
	"details" text,
	"is_published" smallint DEFAULT 0 NOT NULL,
	"author" text,
	"category" varchar(255),
	"description" text,
	"color" varchar(255) DEFAULT '#3972F6' NOT NULL,
	"use_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" varchar(255) NOT NULL,
	"email_verified" smallint NOT NULL,
	"image" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"stripe_customer_id" varchar(255),
	"is_super_user" smallint DEFAULT 0 NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_stats" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"total_manual_executions" integer DEFAULT 0 NOT NULL,
	"total_api_calls" integer DEFAULT 0 NOT NULL,
	"total_webhook_triggers" integer DEFAULT 0 NOT NULL,
	"total_scheduled_executions" integer DEFAULT 0 NOT NULL,
	"total_chat_executions" integer DEFAULT 0 NOT NULL,
	"total_tokens_used" integer DEFAULT 0 NOT NULL,
	"total_cost" numeric DEFAULT '0' NOT NULL,
	"current_usage_limit" numeric DEFAULT '20',
	"usage_limit_updated_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	"current_period_cost" numeric DEFAULT '0' NOT NULL,
	"last_period_cost" numeric DEFAULT '0',
	"billed_overage_this_period" numeric DEFAULT '0' NOT NULL,
	"pro_period_cost_snapshot" numeric DEFAULT '0',
	"credit_balance" numeric DEFAULT '0' NOT NULL,
	"total_copilot_cost" numeric DEFAULT '0' NOT NULL,
	"current_period_copilot_cost" numeric DEFAULT '0' NOT NULL,
	"last_period_copilot_cost" numeric DEFAULT '0',
	"total_copilot_tokens" integer DEFAULT 0 NOT NULL,
	"total_copilot_calls" integer DEFAULT 0 NOT NULL,
	"storage_used_bytes" bigint DEFAULT 0 NOT NULL,
	"last_active" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"billing_blocked" smallint DEFAULT 0 NOT NULL,
	"billing_blocked_reason" varchar(255),
	CONSTRAINT "user_stats_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "verification" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"identifier" varchar(255) NOT NULL,
	"value" varchar(255) NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp,
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "waitlist" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"email" varchar(255) NOT NULL,
	"status" varchar(255) DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "waitlist_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "webhook" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"workflow_id" varchar(255) NOT NULL,
	"block_id" varchar(255),
	"path" varchar(1024) NOT NULL,
	"provider" varchar(255),
	"provider_config" text,
	"is_active" smallint DEFAULT 1 NOT NULL,
	"failed_count" integer DEFAULT 0,
	"last_failed_at" timestamp,
	"credential_set_id" varchar(255),
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workflow" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"workspace_id" varchar(255),
	"folder_id" varchar(255),
	"name" text NOT NULL,
	"description" text,
	"color" text DEFAULT '#3972F6' NOT NULL,
	"last_synced" timestamp NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"is_deployed" smallint DEFAULT 0 NOT NULL,
	"deployed_at" timestamp,
	"run_count" integer DEFAULT 0 NOT NULL,
	"last_run_at" timestamp,
	"variables" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workflow_blocks" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"workflow_id" varchar(255) NOT NULL,
	"type" varchar(255) NOT NULL,
	"name" text NOT NULL,
	"position_x" numeric NOT NULL,
	"position_y" numeric NOT NULL,
	"enabled" smallint DEFAULT 1 NOT NULL,
	"horizontal_handles" smallint DEFAULT 1 NOT NULL,
	"is_wide" smallint DEFAULT 0 NOT NULL,
	"advanced_mode" smallint DEFAULT 0 NOT NULL,
	"trigger_mode" smallint DEFAULT 0 NOT NULL,
	"height" numeric DEFAULT '0' NOT NULL,
	"sub_blocks" text NOT NULL,
	"outputs" text NOT NULL,
	"data" text,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workflow_checkpoints" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"workflow_id" varchar(255) NOT NULL,
	"name" text,
	"data" text NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workflow_deployment_version" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"workflow_id" varchar(255) NOT NULL,
	"version" integer NOT NULL,
	"definition" text NOT NULL,
	"description" text,
	"deployed_by" varchar(255),
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workflow_edges" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"workflow_id" varchar(255) NOT NULL,
	"source_block_id" varchar(255) NOT NULL,
	"target_block_id" varchar(255) NOT NULL,
	"source_handle" varchar(255),
	"target_handle" varchar(255),
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workflow_execution_logs" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"workflow_id" varchar(255) NOT NULL,
	"workspace_id" varchar(255) NOT NULL,
	"execution_id" varchar(255) NOT NULL,
	"state_snapshot_id" varchar(255) NOT NULL,
	"deployment_version_id" varchar(255),
	"level" varchar(255) NOT NULL,
	"status" varchar(255) DEFAULT 'running' NOT NULL,
	"trigger" varchar(255) NOT NULL,
	"started_at" timestamp NOT NULL,
	"ended_at" timestamp,
	"total_duration_ms" integer,
	"execution_data" text NOT NULL,
	"cost" text,
	"files" text,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workflow_execution_snapshots" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"workflow_id" varchar(255) NOT NULL,
	"state_hash" varchar(255) NOT NULL,
	"state_data" text NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workflow_folder" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"workspace_id" varchar(255) NOT NULL,
	"parent_id" varchar(255),
	"color" varchar(255) DEFAULT '#6B7280',
	"is_expanded" smallint DEFAULT 1 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workflow_mcp_server" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"workspace_id" varchar(255) NOT NULL,
	"created_by" varchar(255) NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"type" varchar(255) NOT NULL,
	"base_url" varchar(1024) NOT NULL,
	"api_key" text,
	"status" varchar(255) DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workflow_mcp_tool" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"server_id" varchar(255) NOT NULL,
	"workflow_id" varchar(255) NOT NULL,
	"tool_name" varchar(255) NOT NULL,
	"description" text,
	"input_schema" text,
	"is_enabled" smallint DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workflow_schedule" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"workflow_id" varchar(255) NOT NULL,
	"block_id" varchar(255),
	"cron_expression" varchar(255),
	"next_run_at" timestamp,
	"last_ran_at" timestamp,
	"last_queued_at" timestamp,
	"trigger_type" varchar(255) NOT NULL,
	"timezone" varchar(255) DEFAULT 'UTC' NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"status" varchar(255) DEFAULT 'active' NOT NULL,
	"last_failed_at" timestamp,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workflow_subflows" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"workflow_id" varchar(255) NOT NULL,
	"type" varchar(255) NOT NULL,
	"config" text NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workspace" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"owner_id" varchar(255) NOT NULL,
	"billed_account_user_id" varchar(255) NOT NULL,
	"allow_personal_api_keys" smallint DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workspace_byok_keys" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"workspace_id" varchar(255) NOT NULL,
	"provider_id" varchar(255) NOT NULL,
	"encrypted_api_key" text NOT NULL,
	"created_by" varchar(255),
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workspace_environment" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"workspace_id" varchar(255) NOT NULL,
	"variables" text NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workspace_file" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"workspace_id" varchar(255) NOT NULL,
	"name" text NOT NULL,
	"key" varchar(1024) NOT NULL,
	"size" integer NOT NULL,
	"type" text NOT NULL,
	"uploaded_by" varchar(255) NOT NULL,
	"uploaded_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "workspace_file_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workspace_files" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"key" varchar(1024) NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"workspace_id" varchar(255),
	"context" varchar(255) NOT NULL,
	"original_name" text NOT NULL,
	"content_type" varchar(255) NOT NULL,
	"size" integer NOT NULL,
	"uploaded_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "workspace_files_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workspace_invitation" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"workspace_id" varchar(255) NOT NULL,
	"email" varchar(255) NOT NULL,
	"inviter_id" varchar(255) NOT NULL,
	"role" varchar(255) DEFAULT 'member' NOT NULL,
	"status" varchar(255) DEFAULT 'pending' NOT NULL,
	"token" varchar(1024) NOT NULL,
	"permissions" varchar(255) DEFAULT 'admin' NOT NULL,
	"org_invitation_id" varchar(255),
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "workspace_invitation_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workspace_notification_delivery" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"subscription_id" varchar(255) NOT NULL,
	"workflow_id" varchar(255) NOT NULL,
	"execution_id" varchar(255) NOT NULL,
	"status" varchar(255) DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp,
	"next_attempt_at" timestamp,
	"response_status" integer,
	"response_body" text,
	"error_message" text,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workspace_notification_subscription" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"workspace_id" varchar(255) NOT NULL,
	"notification_type" varchar(255) NOT NULL,
	"workflow_ids" text NOT NULL,
	"all_workflows" smallint DEFAULT 0 NOT NULL,
	"level_filter" text NOT NULL,
	"trigger_filter" text NOT NULL,
	"include_final_output" smallint DEFAULT 0 NOT NULL,
	"include_trace_spans" smallint DEFAULT 0 NOT NULL,
	"include_rate_limits" smallint DEFAULT 0 NOT NULL,
	"include_usage_data" smallint DEFAULT 0 NOT NULL,
	"webhook_config" text,
	"email_recipients" text,
	"slack_config" text,
	"alert_config" text,
	"last_alert_at" timestamp,
	"active" smallint DEFAULT 1 NOT NULL,
	"created_by" varchar(255) NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "a2a_agent" ADD CONSTRAINT "a2a_agent_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "a2a_agent" ADD CONSTRAINT "a2a_agent_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "workflow"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "a2a_agent" ADD CONSTRAINT "a2a_agent_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "a2a_task" ADD CONSTRAINT "a2a_task_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "a2a_task" ADD CONSTRAINT "a2a_task_agent_id_a2a_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "a2a_agent"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "api_key" ADD CONSTRAINT "api_key_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "api_key" ADD CONSTRAINT "api_key_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "api_key" ADD CONSTRAINT "api_key_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "chat" ADD CONSTRAINT "chat_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "workflow"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "chat" ADD CONSTRAINT "chat_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "copilot_chats" ADD CONSTRAINT "copilot_chats_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "copilot_chats" ADD CONSTRAINT "copilot_chats_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "workflow"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "copilot_feedback" ADD CONSTRAINT "copilot_feedback_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "copilot_messages" ADD CONSTRAINT "copilot_messages_chat_id_copilot_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "copilot_chats"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "credential_set" ADD CONSTRAINT "credential_set_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "credential_set_invitation" ADD CONSTRAINT "credential_set_invitation_credential_set_id_credential_set_id_fk" FOREIGN KEY ("credential_set_id") REFERENCES "credential_set"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "credential_set_invitation" ADD CONSTRAINT "credential_set_invitation_inviter_id_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "user"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "credential_set_membership" ADD CONSTRAINT "credential_set_membership_credential_set_id_credential_set_id_fk" FOREIGN KEY ("credential_set_id") REFERENCES "credential_set"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "credential_set_membership" ADD CONSTRAINT "credential_set_membership_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "custom_tools" ADD CONSTRAINT "custom_tools_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "custom_tools" ADD CONSTRAINT "custom_tools_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_knowledge_base_id_knowledge_base_id_fk" FOREIGN KEY ("knowledge_base_id") REFERENCES "knowledge_base"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "embedding" ADD CONSTRAINT "embedding_knowledge_base_id_knowledge_base_id_fk" FOREIGN KEY ("knowledge_base_id") REFERENCES "knowledge_base"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "embedding" ADD CONSTRAINT "embedding_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "document"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "environment" ADD CONSTRAINT "environment_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "form" ADD CONSTRAINT "form_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "workflow"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "form" ADD CONSTRAINT "form_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviter_id_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "user"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "knowledge_base" ADD CONSTRAINT "knowledge_base_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "knowledge_base" ADD CONSTRAINT "knowledge_base_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE no action;--> statement-breakpoint
ALTER TABLE "knowledge_base_tag_definitions" ADD CONSTRAINT "knowledge_base_tag_definitions_knowledge_base_id_knowledge_base_id_fk" FOREIGN KEY ("knowledge_base_id") REFERENCES "knowledge_base"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD CONSTRAINT "mcp_servers_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "memory" ADD CONSTRAINT "memory_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "paused_executions" ADD CONSTRAINT "paused_executions_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "workflow"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "permission_group" ADD CONSTRAINT "permission_group_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "permission_group_member" ADD CONSTRAINT "permission_group_member_group_id_permission_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "permission_group"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "permission_group_member" ADD CONSTRAINT "permission_group_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "permissions" ADD CONSTRAINT "permissions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "resume_queue" ADD CONSTRAINT "resume_queue_paused_execution_id_paused_executions_id_fk" FOREIGN KEY ("paused_execution_id") REFERENCES "paused_executions"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_active_organization_id_organization_id_fk" FOREIGN KEY ("active_organization_id") REFERENCES "organization"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "sso_provider" ADD CONSTRAINT "sso_provider_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "template_stars" ADD CONSTRAINT "template_stars_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "template_stars" ADD CONSTRAINT "template_stars_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "templates"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "workflow"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "user_stats" ADD CONSTRAINT "user_stats_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "webhook" ADD CONSTRAINT "webhook_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "workflow"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "webhook" ADD CONSTRAINT "webhook_block_id_workflow_blocks_id_fk" FOREIGN KEY ("block_id") REFERENCES "workflow_blocks"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "webhook" ADD CONSTRAINT "webhook_credential_set_id_credential_set_id_fk" FOREIGN KEY ("credential_set_id") REFERENCES "credential_set"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "workflow" ADD CONSTRAINT "workflow_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "workflow" ADD CONSTRAINT "workflow_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "workflow" ADD CONSTRAINT "workflow_folder_id_workflow_folder_id_fk" FOREIGN KEY ("folder_id") REFERENCES "workflow_folder"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "workflow_blocks" ADD CONSTRAINT "workflow_blocks_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "workflow"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "workflow_checkpoints" ADD CONSTRAINT "workflow_checkpoints_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "workflow_checkpoints" ADD CONSTRAINT "workflow_checkpoints_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "workflow"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "workflow_deployment_version" ADD CONSTRAINT "workflow_deployment_version_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "workflow"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "workflow_deployment_version" ADD CONSTRAINT "workflow_deployment_version_deployed_by_user_id_fk" FOREIGN KEY ("deployed_by") REFERENCES "user"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "workflow_edges" ADD CONSTRAINT "workflow_edges_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "workflow"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "workflow_edges" ADD CONSTRAINT "workflow_edges_source_block_id_workflow_blocks_id_fk" FOREIGN KEY ("source_block_id") REFERENCES "workflow_blocks"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "workflow_edges" ADD CONSTRAINT "workflow_edges_target_block_id_workflow_blocks_id_fk" FOREIGN KEY ("target_block_id") REFERENCES "workflow_blocks"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "workflow_execution_logs" ADD CONSTRAINT "workflow_execution_logs_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "workflow"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "workflow_execution_logs" ADD CONSTRAINT "workflow_execution_logs_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "workflow_execution_logs" ADD CONSTRAINT "workflow_execution_logs_state_snapshot_id_workflow_execution_snapshots_id_fk" FOREIGN KEY ("state_snapshot_id") REFERENCES "workflow_execution_snapshots"("id") ON DELETE no action;--> statement-breakpoint
ALTER TABLE "workflow_execution_logs" ADD CONSTRAINT "workflow_execution_logs_deployment_version_id_workflow_deployment_version_id_fk" FOREIGN KEY ("deployment_version_id") REFERENCES "workflow_deployment_version"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "workflow_execution_snapshots" ADD CONSTRAINT "workflow_execution_snapshots_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "workflow"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "workflow_folder" ADD CONSTRAINT "workflow_folder_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "workflow_folder" ADD CONSTRAINT "workflow_folder_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "workflow_mcp_server" ADD CONSTRAINT "workflow_mcp_server_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "workflow_mcp_server" ADD CONSTRAINT "workflow_mcp_server_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "workflow_mcp_tool" ADD CONSTRAINT "workflow_mcp_tool_server_id_workflow_mcp_server_id_fk" FOREIGN KEY ("server_id") REFERENCES "workflow_mcp_server"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "workflow_mcp_tool" ADD CONSTRAINT "workflow_mcp_tool_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "workflow"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "workflow_schedule" ADD CONSTRAINT "workflow_schedule_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "workflow"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "workflow_schedule" ADD CONSTRAINT "workflow_schedule_block_id_workflow_blocks_id_fk" FOREIGN KEY ("block_id") REFERENCES "workflow_blocks"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "workflow_subflows" ADD CONSTRAINT "workflow_subflows_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "workflow"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "workspace" ADD CONSTRAINT "workspace_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "user"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "workspace" ADD CONSTRAINT "workspace_billed_account_user_id_user_id_fk" FOREIGN KEY ("billed_account_user_id") REFERENCES "user"("id") ON DELETE no action;--> statement-breakpoint
ALTER TABLE "workspace_byok_keys" ADD CONSTRAINT "workspace_byok_keys_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "workspace_byok_keys" ADD CONSTRAINT "workspace_byok_keys_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "workspace_environment" ADD CONSTRAINT "workspace_environment_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "workspace_file" ADD CONSTRAINT "workspace_file_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "workspace_file" ADD CONSTRAINT "workspace_file_uploaded_by_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "user"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "workspace_files" ADD CONSTRAINT "workspace_files_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "workspace_files" ADD CONSTRAINT "workspace_files_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "workspace_invitation" ADD CONSTRAINT "workspace_invitation_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "workspace_invitation" ADD CONSTRAINT "workspace_invitation_inviter_id_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "user"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "workspace_notification_delivery" ADD CONSTRAINT "workspace_notification_delivery_subscription_id_workspace_notification_subscription_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "workspace_notification_subscription"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "workspace_notification_delivery" ADD CONSTRAINT "workspace_notification_delivery_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "workflow"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "workspace_notification_subscription" ADD CONSTRAINT "workspace_notification_subscription_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "workspace_notification_subscription" ADD CONSTRAINT "workspace_notification_subscription_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE cascade;--> statement-breakpoint
CREATE INDEX "a2a_agent_workspace_id_idx" ON "a2a_agent" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "a2a_agent_workflow_id_idx" ON "a2a_agent" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "a2a_agent_status_idx" ON "a2a_agent" USING btree ("status");--> statement-breakpoint
CREATE INDEX "a2a_task_workspace_id_idx" ON "a2a_task" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "a2a_task_agent_id_idx" ON "a2a_task" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "a2a_task_status_idx" ON "a2a_task" USING btree ("status");--> statement-breakpoint
CREATE INDEX "account_user_id_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_account_on_account_id_provider_id" ON "account" USING btree ("account_id","provider_id");--> statement-breakpoint
CREATE UNIQUE INDEX "account_user_provider_account_unique" ON "account" USING btree ("user_id","provider_id","account_id");--> statement-breakpoint
CREATE INDEX "api_key_workspace_type_idx" ON "api_key" USING btree ("workspace_id","type");--> statement-breakpoint
CREATE INDEX "api_key_user_type_idx" ON "api_key" USING btree ("user_id","type");--> statement-breakpoint
CREATE UNIQUE INDEX "identifier_idx" ON "chat" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "copilot_chats_user_id_idx" ON "copilot_chats" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "copilot_chats_workflow_id_idx" ON "copilot_chats" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "copilot_feedback_user_id_idx" ON "copilot_feedback" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "copilot_feedback_message_id_idx" ON "copilot_feedback" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "copilot_messages_chat_id_idx" ON "copilot_messages" USING btree ("chat_id");--> statement-breakpoint
CREATE INDEX "credential_set_workspace_id_idx" ON "credential_set" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "credential_set_provider_id_idx" ON "credential_set" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "credential_set_invitation_set_id_idx" ON "credential_set_invitation" USING btree ("credential_set_id");--> statement-breakpoint
CREATE INDEX "credential_set_invitation_email_idx" ON "credential_set_invitation" USING btree ("email");--> statement-breakpoint
CREATE INDEX "credential_set_membership_set_id_idx" ON "credential_set_membership" USING btree ("credential_set_id");--> statement-breakpoint
CREATE INDEX "credential_set_membership_user_id_idx" ON "credential_set_membership" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "credential_set_membership_unique_idx" ON "credential_set_membership" USING btree ("credential_set_id","user_id");--> statement-breakpoint
CREATE INDEX "custom_tools_workspace_id_idx" ON "custom_tools" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "custom_tools_workspace_title_unique" ON "custom_tools" USING btree ("workspace_id","title");--> statement-breakpoint
CREATE INDEX "doc_kb_id_idx" ON "document" USING btree ("knowledge_base_id");--> statement-breakpoint
CREATE INDEX "doc_filename_idx" ON "document" USING btree ("filename");--> statement-breakpoint
CREATE INDEX "doc_processing_status_idx" ON "document" USING btree ("knowledge_base_id","processing_status");--> statement-breakpoint
CREATE INDEX "doc_tag1_idx" ON "document" USING btree ("tag1");--> statement-breakpoint
CREATE INDEX "doc_tag2_idx" ON "document" USING btree ("tag2");--> statement-breakpoint
CREATE INDEX "doc_tag3_idx" ON "document" USING btree ("tag3");--> statement-breakpoint
CREATE INDEX "doc_tag4_idx" ON "document" USING btree ("tag4");--> statement-breakpoint
CREATE INDEX "doc_tag5_idx" ON "document" USING btree ("tag5");--> statement-breakpoint
CREATE INDEX "doc_tag6_idx" ON "document" USING btree ("tag6");--> statement-breakpoint
CREATE INDEX "doc_tag7_idx" ON "document" USING btree ("tag7");--> statement-breakpoint
CREATE INDEX "doc_number1_idx" ON "document" USING btree ("number1");--> statement-breakpoint
CREATE INDEX "doc_number2_idx" ON "document" USING btree ("number2");--> statement-breakpoint
CREATE INDEX "doc_number3_idx" ON "document" USING btree ("number3");--> statement-breakpoint
CREATE INDEX "doc_number4_idx" ON "document" USING btree ("number4");--> statement-breakpoint
CREATE INDEX "doc_number5_idx" ON "document" USING btree ("number5");--> statement-breakpoint
CREATE INDEX "doc_date1_idx" ON "document" USING btree ("date1");--> statement-breakpoint
CREATE INDEX "doc_date2_idx" ON "document" USING btree ("date2");--> statement-breakpoint
CREATE INDEX "doc_boolean1_idx" ON "document" USING btree ("boolean1");--> statement-breakpoint
CREATE INDEX "doc_boolean2_idx" ON "document" USING btree ("boolean2");--> statement-breakpoint
CREATE INDEX "doc_boolean3_idx" ON "document" USING btree ("boolean3");--> statement-breakpoint
CREATE INDEX "emb_kb_id_idx" ON "embedding" USING btree ("knowledge_base_id");--> statement-breakpoint
CREATE INDEX "emb_doc_id_idx" ON "embedding" USING btree ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "emb_doc_chunk_idx" ON "embedding" USING btree ("document_id","chunk_index");--> statement-breakpoint
CREATE INDEX "emb_kb_model_idx" ON "embedding" USING btree ("knowledge_base_id","embedding_model");--> statement-breakpoint
CREATE INDEX "emb_kb_enabled_idx" ON "embedding" USING btree ("knowledge_base_id","enabled");--> statement-breakpoint
CREATE INDEX "emb_doc_enabled_idx" ON "embedding" USING btree ("document_id","enabled");--> statement-breakpoint
CREATE INDEX "emb_tag1_idx" ON "embedding" USING btree ("tag1");--> statement-breakpoint
CREATE INDEX "emb_tag2_idx" ON "embedding" USING btree ("tag2");--> statement-breakpoint
CREATE INDEX "emb_tag3_idx" ON "embedding" USING btree ("tag3");--> statement-breakpoint
CREATE INDEX "emb_tag4_idx" ON "embedding" USING btree ("tag4");--> statement-breakpoint
CREATE INDEX "emb_tag5_idx" ON "embedding" USING btree ("tag5");--> statement-breakpoint
CREATE INDEX "emb_tag6_idx" ON "embedding" USING btree ("tag6");--> statement-breakpoint
CREATE INDEX "emb_tag7_idx" ON "embedding" USING btree ("tag7");--> statement-breakpoint
CREATE INDEX "emb_number1_idx" ON "embedding" USING btree ("number1");--> statement-breakpoint
CREATE INDEX "emb_number2_idx" ON "embedding" USING btree ("number2");--> statement-breakpoint
CREATE INDEX "emb_number3_idx" ON "embedding" USING btree ("number3");--> statement-breakpoint
CREATE INDEX "emb_number4_idx" ON "embedding" USING btree ("number4");--> statement-breakpoint
CREATE INDEX "emb_number5_idx" ON "embedding" USING btree ("number5");--> statement-breakpoint
CREATE INDEX "emb_date1_idx" ON "embedding" USING btree ("date1");--> statement-breakpoint
CREATE INDEX "emb_date2_idx" ON "embedding" USING btree ("date2");--> statement-breakpoint
CREATE INDEX "emb_boolean1_idx" ON "embedding" USING btree ("boolean1");--> statement-breakpoint
CREATE INDEX "emb_boolean2_idx" ON "embedding" USING btree ("boolean2");--> statement-breakpoint
CREATE INDEX "emb_boolean3_idx" ON "embedding" USING btree ("boolean3");--> statement-breakpoint
CREATE UNIQUE INDEX "form_identifier_idx" ON "form" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "form_workflow_id_idx" ON "form" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "form_user_id_idx" ON "form" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idempotency_key_expires_at_idx" ON "idempotency_key" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "invitation_email_idx" ON "invitation" USING btree ("email");--> statement-breakpoint
CREATE INDEX "invitation_organization_id_idx" ON "invitation" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "kb_user_id_idx" ON "knowledge_base" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "kb_workspace_id_idx" ON "knowledge_base" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "kb_user_workspace_idx" ON "knowledge_base" USING btree ("user_id","workspace_id");--> statement-breakpoint
CREATE INDEX "kb_deleted_at_idx" ON "knowledge_base" USING btree ("deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "kb_tag_definitions_kb_slot_idx" ON "knowledge_base_tag_definitions" USING btree ("knowledge_base_id","tag_slot");--> statement-breakpoint
CREATE UNIQUE INDEX "kb_tag_definitions_kb_display_name_idx" ON "knowledge_base_tag_definitions" USING btree ("knowledge_base_id","display_name");--> statement-breakpoint
CREATE INDEX "kb_tag_definitions_kb_id_idx" ON "knowledge_base_tag_definitions" USING btree ("knowledge_base_id");--> statement-breakpoint
CREATE INDEX "mcp_servers_workspace_id_idx" ON "mcp_servers" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "mcp_servers_status_idx" ON "mcp_servers" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "member_user_id_unique" ON "member" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "member_organization_id_idx" ON "member" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "memory_key_idx" ON "memory" USING btree ("key");--> statement-breakpoint
CREATE INDEX "memory_workspace_idx" ON "memory" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memory_workspace_key_idx" ON "memory" USING btree ("workspace_id","key");--> statement-breakpoint
CREATE INDEX "paused_executions_workflow_id_idx" ON "paused_executions" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "paused_executions_status_idx" ON "paused_executions" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "paused_executions_execution_id_unique" ON "paused_executions" USING btree ("execution_id");--> statement-breakpoint
CREATE INDEX "permission_group_workspace_id_idx" ON "permission_group" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "permission_group_member_group_id_idx" ON "permission_group_member" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "permission_group_member_user_id_idx" ON "permission_group_member" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "permission_group_member_unique_idx" ON "permission_group_member" USING btree ("group_id","user_id");--> statement-breakpoint
CREATE INDEX "permissions_user_id_idx" ON "permissions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "permissions_entity_idx" ON "permissions" USING btree ("entity_kind","entity_id");--> statement-breakpoint
CREATE INDEX "permissions_user_entity_type_idx" ON "permissions" USING btree ("user_id","entity_kind");--> statement-breakpoint
CREATE INDEX "permissions_user_entity_permission_idx" ON "permissions" USING btree ("user_id","entity_kind","permission_kind");--> statement-breakpoint
CREATE INDEX "permissions_user_entity_idx" ON "permissions" USING btree ("user_id","entity_kind","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "permissions_unique_constraint" ON "permissions" USING btree ("user_id","entity_kind","entity_id");--> statement-breakpoint
CREATE INDEX "resume_queue_parent_status_idx" ON "resume_queue" USING btree ("parent_execution_id","status","queued_at");--> statement-breakpoint
CREATE INDEX "resume_queue_new_execution_idx" ON "resume_queue" USING btree ("new_execution_id");--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_token_idx" ON "session" USING btree ("token");--> statement-breakpoint
CREATE INDEX "sso_provider_issuer_idx" ON "sso_provider" USING btree ("issuer");--> statement-breakpoint
CREATE INDEX "sso_provider_domain_idx" ON "sso_provider" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "sso_provider_user_id_idx" ON "sso_provider" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "subscription_reference_status_idx" ON "subscription" USING btree ("reference_id","status");--> statement-breakpoint
CREATE INDEX "template_stars_user_id_idx" ON "template_stars" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "template_stars_template_id_idx" ON "template_stars" USING btree ("template_id");--> statement-breakpoint
CREATE UNIQUE INDEX "template_stars_unique_idx" ON "template_stars" USING btree ("user_id","template_id");--> statement-breakpoint
CREATE INDEX "templates_category_idx" ON "templates" USING btree ("category");--> statement-breakpoint
CREATE INDEX "templates_is_published_idx" ON "templates" USING btree ("is_published");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "verification_expires_at_idx" ON "verification" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "path_idx" ON "webhook" USING btree ("path");--> statement-breakpoint
CREATE INDEX "idx_webhook_on_workflow_id_block_id" ON "webhook" USING btree ("workflow_id","block_id");--> statement-breakpoint
CREATE INDEX "webhook_credential_set_id_idx" ON "webhook" USING btree ("credential_set_id");--> statement-breakpoint
CREATE INDEX "workflow_user_id_idx" ON "workflow" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "workflow_workspace_id_idx" ON "workflow" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "workflow_user_workspace_idx" ON "workflow" USING btree ("user_id","workspace_id");--> statement-breakpoint
CREATE INDEX "workflow_blocks_workflow_id_idx" ON "workflow_blocks" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "workflow_blocks_type_idx" ON "workflow_blocks" USING btree ("type");--> statement-breakpoint
CREATE INDEX "workflow_checkpoints_workflow_id_idx" ON "workflow_checkpoints" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "workflow_deployment_workflow_id_idx" ON "workflow_deployment_version" USING btree ("workflow_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_deployment_workflow_version_unique" ON "workflow_deployment_version" USING btree ("workflow_id","version");--> statement-breakpoint
CREATE INDEX "workflow_edges_workflow_id_idx" ON "workflow_edges" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "workflow_edges_workflow_source_idx" ON "workflow_edges" USING btree ("workflow_id","source_block_id");--> statement-breakpoint
CREATE INDEX "workflow_edges_workflow_target_idx" ON "workflow_edges" USING btree ("workflow_id","target_block_id");--> statement-breakpoint
CREATE INDEX "workflow_execution_logs_workflow_id_idx" ON "workflow_execution_logs" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "workflow_execution_logs_state_snapshot_id_idx" ON "workflow_execution_logs" USING btree ("state_snapshot_id");--> statement-breakpoint
CREATE INDEX "workflow_execution_logs_deployment_version_id_idx" ON "workflow_execution_logs" USING btree ("deployment_version_id");--> statement-breakpoint
CREATE INDEX "workflow_execution_logs_trigger_idx" ON "workflow_execution_logs" USING btree ("trigger");--> statement-breakpoint
CREATE INDEX "workflow_execution_logs_level_idx" ON "workflow_execution_logs" USING btree ("level");--> statement-breakpoint
CREATE INDEX "workflow_execution_logs_started_at_idx" ON "workflow_execution_logs" USING btree ("started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_execution_logs_execution_id_unique" ON "workflow_execution_logs" USING btree ("execution_id");--> statement-breakpoint
CREATE INDEX "workflow_execution_logs_workflow_started_at_idx" ON "workflow_execution_logs" USING btree ("workflow_id","started_at");--> statement-breakpoint
CREATE INDEX "workflow_execution_logs_workspace_started_at_idx" ON "workflow_execution_logs" USING btree ("workspace_id","started_at");--> statement-breakpoint
CREATE INDEX "workflow_snapshots_workflow_id_idx" ON "workflow_execution_snapshots" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "workflow_snapshots_hash_idx" ON "workflow_execution_snapshots" USING btree ("state_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_snapshots_workflow_hash_idx" ON "workflow_execution_snapshots" USING btree ("workflow_id","state_hash");--> statement-breakpoint
CREATE INDEX "workflow_snapshots_created_at_idx" ON "workflow_execution_snapshots" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "workflow_folder_user_idx" ON "workflow_folder" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "workflow_folder_workspace_parent_idx" ON "workflow_folder" USING btree ("workspace_id","parent_id");--> statement-breakpoint
CREATE INDEX "workflow_folder_parent_sort_idx" ON "workflow_folder" USING btree ("parent_id","sort_order");--> statement-breakpoint
CREATE INDEX "workflow_mcp_server_workspace_id_idx" ON "workflow_mcp_server" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "workflow_mcp_server_status_idx" ON "workflow_mcp_server" USING btree ("status");--> statement-breakpoint
CREATE INDEX "workflow_mcp_tool_server_id_idx" ON "workflow_mcp_tool" USING btree ("server_id");--> statement-breakpoint
CREATE INDEX "workflow_mcp_tool_workflow_id_idx" ON "workflow_mcp_tool" USING btree ("workflow_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_mcp_tool_unique_idx" ON "workflow_mcp_tool" USING btree ("workflow_id","tool_name");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_schedule_workflow_block_unique" ON "workflow_schedule" USING btree ("workflow_id","block_id");--> statement-breakpoint
CREATE INDEX "workflow_subflows_workflow_id_idx" ON "workflow_subflows" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "workflow_subflows_workflow_type_idx" ON "workflow_subflows" USING btree ("workflow_id","type");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_byok_provider_unique" ON "workspace_byok_keys" USING btree ("workspace_id","provider_id");--> statement-breakpoint
CREATE INDEX "workspace_byok_workspace_idx" ON "workspace_byok_keys" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_environment_workspace_unique" ON "workspace_environment" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "workspace_file_workspace_id_idx" ON "workspace_file" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "workspace_file_key_idx" ON "workspace_file" USING btree ("key");--> statement-breakpoint
CREATE INDEX "workspace_files_key_idx" ON "workspace_files" USING btree ("key");--> statement-breakpoint
CREATE INDEX "workspace_files_user_id_idx" ON "workspace_files" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "workspace_files_workspace_id_idx" ON "workspace_files" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "workspace_files_context_idx" ON "workspace_files" USING btree ("context");--> statement-breakpoint
CREATE INDEX "workspace_notification_delivery_subscription_id_idx" ON "workspace_notification_delivery" USING btree ("subscription_id");--> statement-breakpoint
CREATE INDEX "workspace_notification_delivery_execution_id_idx" ON "workspace_notification_delivery" USING btree ("execution_id");--> statement-breakpoint
CREATE INDEX "workspace_notification_delivery_status_idx" ON "workspace_notification_delivery" USING btree ("status");--> statement-breakpoint
CREATE INDEX "workspace_notification_delivery_next_attempt_idx" ON "workspace_notification_delivery" USING btree ("next_attempt_at");--> statement-breakpoint
CREATE INDEX "workspace_notification_workspace_id_idx" ON "workspace_notification_subscription" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "workspace_notification_active_idx" ON "workspace_notification_subscription" USING btree ("active");--> statement-breakpoint
CREATE INDEX "workspace_notification_type_idx" ON "workspace_notification_subscription" USING btree ("notification_type");