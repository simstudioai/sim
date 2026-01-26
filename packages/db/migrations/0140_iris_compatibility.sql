CREATE TABLE "copilot_messages" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"chat_id" varchar(255) NOT NULL,
	"role" varchar(255) NOT NULL,
	"content" text NOT NULL,
	"diff" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credential_set_membership" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"credential_set_id" varchar(255) NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"role" varchar(255) DEFAULT 'member' NOT NULL,
	"status" varchar(255) DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "a2a_push_notification_config" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "credential_set_member" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "template_creators" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "usage_log" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "a2a_push_notification_config" CASCADE;--> statement-breakpoint
DROP TABLE "credential_set_member" CASCADE;--> statement-breakpoint
DROP TABLE "template_creators" CASCADE;--> statement-breakpoint
DROP TABLE "usage_log" CASCADE;--> statement-breakpoint
ALTER TABLE "docs_embeddings" DROP CONSTRAINT "docs_embedding_not_null_check";--> statement-breakpoint
ALTER TABLE "docs_embeddings" DROP CONSTRAINT "docs_header_level_check";--> statement-breakpoint
ALTER TABLE "copilot_feedback" DROP CONSTRAINT "copilot_feedback_chat_id_copilot_chats_id_fk";
--> statement-breakpoint
ALTER TABLE "credential_set" DROP CONSTRAINT "credential_set_organization_id_organization_id_fk";
--> statement-breakpoint
ALTER TABLE "credential_set" DROP CONSTRAINT "credential_set_created_by_user_id_fk";
--> statement-breakpoint
ALTER TABLE "credential_set_invitation" DROP CONSTRAINT "credential_set_invitation_invited_by_user_id_fk";
--> statement-breakpoint
ALTER TABLE "credential_set_invitation" DROP CONSTRAINT "credential_set_invitation_accepted_by_user_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "mcp_servers" DROP CONSTRAINT "mcp_servers_created_by_user_id_fk";
--> statement-breakpoint
ALTER TABLE "permission_group" DROP CONSTRAINT "permission_group_organization_id_organization_id_fk";
--> statement-breakpoint
ALTER TABLE "permission_group" DROP CONSTRAINT "permission_group_created_by_user_id_fk";
--> statement-breakpoint
ALTER TABLE "permission_group_member" DROP CONSTRAINT "permission_group_member_permission_group_id_permission_group_id_fk";
--> statement-breakpoint
ALTER TABLE "permission_group_member" DROP CONSTRAINT "permission_group_member_assigned_by_user_id_fk";
--> statement-breakpoint
ALTER TABLE "sso_provider" DROP CONSTRAINT "sso_provider_organization_id_organization_id_fk";
--> statement-breakpoint
ALTER TABLE "templates" DROP CONSTRAINT "templates_creator_id_template_creators_id_fk";
--> statement-breakpoint
ALTER TABLE "workflow_checkpoints" DROP CONSTRAINT "workflow_checkpoints_chat_id_copilot_chats_id_fk";
--> statement-breakpoint
DROP INDEX "a2a_agent_created_by_idx";--> statement-breakpoint
DROP INDEX "a2a_agent_workspace_workflow_unique";--> statement-breakpoint
DROP INDEX "a2a_task_session_id_idx";--> statement-breakpoint
DROP INDEX "a2a_task_execution_id_idx";--> statement-breakpoint
DROP INDEX "a2a_task_created_at_idx";--> statement-breakpoint
DROP INDEX "copilot_chats_user_workflow_idx";--> statement-breakpoint
DROP INDEX "copilot_chats_created_at_idx";--> statement-breakpoint
DROP INDEX "copilot_chats_updated_at_idx";--> statement-breakpoint
DROP INDEX "copilot_feedback_chat_id_idx";--> statement-breakpoint
DROP INDEX "copilot_feedback_user_chat_idx";--> statement-breakpoint
DROP INDEX "copilot_feedback_is_positive_idx";--> statement-breakpoint
DROP INDEX "copilot_feedback_created_at_idx";--> statement-breakpoint
DROP INDEX "credential_set_organization_id_idx";--> statement-breakpoint
DROP INDEX "credential_set_created_by_idx";--> statement-breakpoint
DROP INDEX "credential_set_org_name_unique";--> statement-breakpoint
DROP INDEX "credential_set_invitation_token_idx";--> statement-breakpoint
DROP INDEX "credential_set_invitation_status_idx";--> statement-breakpoint
DROP INDEX "credential_set_invitation_expires_at_idx";--> statement-breakpoint
DROP INDEX "docs_emb_source_document_idx";--> statement-breakpoint
DROP INDEX "docs_emb_header_level_idx";--> statement-breakpoint
DROP INDEX "docs_emb_source_header_idx";--> statement-breakpoint
DROP INDEX "docs_emb_model_idx";--> statement-breakpoint
DROP INDEX "docs_emb_created_at_idx";--> statement-breakpoint
DROP INDEX "docs_emb_metadata_gin_idx";--> statement-breakpoint
DROP INDEX "docs_emb_chunk_text_fts_idx";--> statement-breakpoint
DROP INDEX "idempotency_key_namespace_unique";--> statement-breakpoint
DROP INDEX "idempotency_key_created_at_idx";--> statement-breakpoint
DROP INDEX "idempotency_key_namespace_idx";--> statement-breakpoint
DROP INDEX "mcp_servers_workspace_enabled_idx";--> statement-breakpoint
DROP INDEX "mcp_servers_workspace_deleted_idx";--> statement-breakpoint
DROP INDEX "permission_group_organization_id_idx";--> statement-breakpoint
DROP INDEX "permission_group_created_by_idx";--> statement-breakpoint
DROP INDEX "permission_group_org_name_unique";--> statement-breakpoint
DROP INDEX "permission_group_member_user_id_unique";--> statement-breakpoint
DROP INDEX "sso_provider_provider_id_idx";--> statement-breakpoint
DROP INDEX "sso_provider_organization_id_idx";--> statement-breakpoint
DROP INDEX "template_stars_user_template_idx";--> statement-breakpoint
DROP INDEX "template_stars_template_user_idx";--> statement-breakpoint
DROP INDEX "template_stars_starred_at_idx";--> statement-breakpoint
DROP INDEX "template_stars_template_starred_at_idx";--> statement-breakpoint
DROP INDEX "template_stars_user_template_unique";--> statement-breakpoint
DROP INDEX "templates_status_idx";--> statement-breakpoint
DROP INDEX "templates_creator_id_idx";--> statement-breakpoint
DROP INDEX "templates_views_idx";--> statement-breakpoint
DROP INDEX "templates_stars_idx";--> statement-breakpoint
DROP INDEX "templates_status_views_idx";--> statement-breakpoint
DROP INDEX "templates_status_stars_idx";--> statement-breakpoint
DROP INDEX "templates_created_at_idx";--> statement-breakpoint
DROP INDEX "templates_updated_at_idx";--> statement-breakpoint
DROP INDEX "workflow_checkpoints_user_id_idx";--> statement-breakpoint
DROP INDEX "workflow_checkpoints_chat_id_idx";--> statement-breakpoint
DROP INDEX "workflow_checkpoints_message_id_idx";--> statement-breakpoint
DROP INDEX "workflow_checkpoints_user_workflow_idx";--> statement-breakpoint
DROP INDEX "workflow_checkpoints_workflow_chat_idx";--> statement-breakpoint
DROP INDEX "workflow_checkpoints_created_at_idx";--> statement-breakpoint
DROP INDEX "workflow_checkpoints_chat_created_at_idx";--> statement-breakpoint
DROP INDEX "workflow_deployment_version_workflow_version_unique";--> statement-breakpoint
DROP INDEX "workflow_deployment_version_workflow_active_idx";--> statement-breakpoint
DROP INDEX "workflow_deployment_version_created_at_idx";--> statement-breakpoint
DROP INDEX "workflow_mcp_server_created_by_idx";--> statement-breakpoint
DROP INDEX "workflow_mcp_tool_server_workflow_unique";--> statement-breakpoint
DROP INDEX "permission_group_member_group_id_idx";--> statement-breakpoint
ALTER TABLE "a2a_agent" ALTER COLUMN "id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "a2a_agent" ALTER COLUMN "workspace_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "a2a_agent" ALTER COLUMN "workflow_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "a2a_agent" ALTER COLUMN "created_by" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "a2a_task" ALTER COLUMN "id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "a2a_task" ALTER COLUMN "agent_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "a2a_task" ALTER COLUMN "status" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "a2a_task" ALTER COLUMN "status" SET DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE "account" ALTER COLUMN "id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "account" ALTER COLUMN "account_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "account" ALTER COLUMN "provider_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "account" ALTER COLUMN "user_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "api_key" ALTER COLUMN "id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "api_key" ALTER COLUMN "user_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "api_key" ALTER COLUMN "workspace_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "api_key" ALTER COLUMN "created_by" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "api_key" ALTER COLUMN "key" SET DATA TYPE varchar(1024);--> statement-breakpoint
ALTER TABLE "api_key" ALTER COLUMN "type" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "api_key" ALTER COLUMN "type" SET DEFAULT 'personal';--> statement-breakpoint
ALTER TABLE "chat" ALTER COLUMN "id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "chat" ALTER COLUMN "workflow_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "chat" ALTER COLUMN "user_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "chat" ALTER COLUMN "identifier" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "chat" ALTER COLUMN "auth_type" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "chat" ALTER COLUMN "auth_type" SET DEFAULT 'public';--> statement-breakpoint
ALTER TABLE "copilot_chats" ALTER COLUMN "id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "copilot_chats" ALTER COLUMN "id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "copilot_chats" ALTER COLUMN "user_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "copilot_chats" ALTER COLUMN "workflow_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "copilot_feedback" ALTER COLUMN "feedback_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "copilot_feedback" ALTER COLUMN "feedback_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "copilot_feedback" ALTER COLUMN "user_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "credential_set" ALTER COLUMN "id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "credential_set" ALTER COLUMN "provider_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "credential_set_invitation" ALTER COLUMN "id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "credential_set_invitation" ALTER COLUMN "credential_set_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "credential_set_invitation" ALTER COLUMN "email" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "credential_set_invitation" ALTER COLUMN "email" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "credential_set_invitation" ALTER COLUMN "token" SET DATA TYPE varchar(1024);--> statement-breakpoint
ALTER TABLE "credential_set_invitation" ALTER COLUMN "status" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "credential_set_invitation" ALTER COLUMN "status" SET DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE "custom_tools" ALTER COLUMN "id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "custom_tools" ALTER COLUMN "workspace_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "custom_tools" ALTER COLUMN "user_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "docs_embeddings" ALTER COLUMN "chunk_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "docs_embeddings" ALTER COLUMN "chunk_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "docs_embeddings" ALTER COLUMN "source_document" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "docs_embeddings" ALTER COLUMN "source_link" SET DATA TYPE varchar(1024);--> statement-breakpoint
ALTER TABLE "docs_embeddings" ALTER COLUMN "embedding_model" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "docs_embeddings" ALTER COLUMN "embedding_model" SET DEFAULT 'text-embedding-3-small';--> statement-breakpoint
ALTER TABLE "document" ALTER COLUMN "id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "document" ALTER COLUMN "knowledge_base_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "document" ALTER COLUMN "file_url" SET DATA TYPE varchar(1024);--> statement-breakpoint
ALTER TABLE "document" ALTER COLUMN "mime_type" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "document" ALTER COLUMN "processing_status" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "document" ALTER COLUMN "processing_status" SET DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE "document" ALTER COLUMN "tag1" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "document" ALTER COLUMN "tag2" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "document" ALTER COLUMN "tag3" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "document" ALTER COLUMN "tag4" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "document" ALTER COLUMN "tag5" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "document" ALTER COLUMN "tag6" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "document" ALTER COLUMN "tag7" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "embedding" ALTER COLUMN "id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "embedding" ALTER COLUMN "knowledge_base_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "embedding" ALTER COLUMN "document_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "embedding" ALTER COLUMN "chunk_hash" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "embedding" ALTER COLUMN "embedding_model" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "embedding" ALTER COLUMN "embedding_model" SET DEFAULT 'text-embedding-3-small';--> statement-breakpoint
ALTER TABLE "embedding" ALTER COLUMN "tag1" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "embedding" ALTER COLUMN "tag2" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "embedding" ALTER COLUMN "tag3" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "embedding" ALTER COLUMN "tag4" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "embedding" ALTER COLUMN "tag5" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "embedding" ALTER COLUMN "tag6" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "embedding" ALTER COLUMN "tag7" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "environment" ALTER COLUMN "id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "environment" ALTER COLUMN "user_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "form" ALTER COLUMN "id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "form" ALTER COLUMN "workflow_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "form" ALTER COLUMN "user_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "form" ALTER COLUMN "identifier" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "form" ALTER COLUMN "auth_type" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "form" ALTER COLUMN "auth_type" SET DEFAULT 'public';--> statement-breakpoint
ALTER TABLE "idempotency_key" ALTER COLUMN "key" SET DATA TYPE varchar(1024);--> statement-breakpoint
ALTER TABLE "idempotency_key" ALTER COLUMN "namespace" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "idempotency_key" ALTER COLUMN "namespace" SET DEFAULT 'default';--> statement-breakpoint
ALTER TABLE "invitation" ALTER COLUMN "id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "invitation" ALTER COLUMN "email" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "invitation" ALTER COLUMN "inviter_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "invitation" ALTER COLUMN "organization_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "invitation" ALTER COLUMN "role" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "invitation" ALTER COLUMN "status" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "knowledge_base" ALTER COLUMN "id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "knowledge_base" ALTER COLUMN "user_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "knowledge_base" ALTER COLUMN "workspace_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "knowledge_base" ALTER COLUMN "embedding_model" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "knowledge_base" ALTER COLUMN "embedding_model" SET DEFAULT 'text-embedding-3-small';--> statement-breakpoint
ALTER TABLE "knowledge_base_tag_definitions" ALTER COLUMN "id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "knowledge_base_tag_definitions" ALTER COLUMN "knowledge_base_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "knowledge_base_tag_definitions" ALTER COLUMN "display_name" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "knowledge_base_tag_definitions" ALTER COLUMN "field_type" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "knowledge_base_tag_definitions" ALTER COLUMN "field_type" SET DEFAULT 'text';--> statement-breakpoint
ALTER TABLE "mcp_servers" ALTER COLUMN "id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "mcp_servers" ALTER COLUMN "workspace_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "mcp_servers" ALTER COLUMN "url" SET DATA TYPE varchar(1024);--> statement-breakpoint
ALTER TABLE "mcp_servers" ALTER COLUMN "url" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "member" ALTER COLUMN "id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "member" ALTER COLUMN "user_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "member" ALTER COLUMN "organization_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "member" ALTER COLUMN "role" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "memory" ALTER COLUMN "id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "memory" ALTER COLUMN "workspace_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "memory" ALTER COLUMN "key" SET DATA TYPE varchar(1024);--> statement-breakpoint
ALTER TABLE "organization" ALTER COLUMN "id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "organization" ALTER COLUMN "slug" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "paused_executions" ALTER COLUMN "id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "paused_executions" ALTER COLUMN "workflow_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "paused_executions" ALTER COLUMN "execution_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "paused_executions" ALTER COLUMN "status" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "paused_executions" ALTER COLUMN "status" SET DEFAULT 'paused';--> statement-breakpoint
ALTER TABLE "permission_group" ALTER COLUMN "id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "permission_group_member" ALTER COLUMN "id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "permission_group_member" ALTER COLUMN "user_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "permissions" ALTER COLUMN "id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "permissions" ALTER COLUMN "user_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "permissions" ALTER COLUMN "entity_type" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "permissions" ALTER COLUMN "entity_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "rate_limit_bucket" ALTER COLUMN "key" SET DATA TYPE varchar(1024);--> statement-breakpoint
ALTER TABLE "resume_queue" ALTER COLUMN "id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "resume_queue" ALTER COLUMN "paused_execution_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "resume_queue" ALTER COLUMN "parent_execution_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "resume_queue" ALTER COLUMN "new_execution_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "resume_queue" ALTER COLUMN "context_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "resume_queue" ALTER COLUMN "status" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "resume_queue" ALTER COLUMN "status" SET DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE "session" ALTER COLUMN "id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "session" ALTER COLUMN "token" SET DATA TYPE varchar(1024);--> statement-breakpoint
ALTER TABLE "session" ALTER COLUMN "ip_address" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "session" ALTER COLUMN "user_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "session" ALTER COLUMN "active_organization_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "settings" ALTER COLUMN "id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "settings" ALTER COLUMN "user_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "settings" ALTER COLUMN "theme" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "settings" ALTER COLUMN "theme" SET DEFAULT 'system';--> statement-breakpoint
ALTER TABLE "sso_provider" ALTER COLUMN "id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "sso_provider" ALTER COLUMN "issuer" SET DATA TYPE varchar(1024);--> statement-breakpoint
ALTER TABLE "sso_provider" ALTER COLUMN "domain" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "sso_provider" ALTER COLUMN "user_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "sso_provider" ALTER COLUMN "provider_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "subscription" ALTER COLUMN "id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "subscription" ALTER COLUMN "plan" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "subscription" ALTER COLUMN "reference_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "subscription" ALTER COLUMN "stripe_customer_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "subscription" ALTER COLUMN "stripe_subscription_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "subscription" ALTER COLUMN "status" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "template_stars" ALTER COLUMN "id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "template_stars" ALTER COLUMN "user_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "template_stars" ALTER COLUMN "template_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "templates" ALTER COLUMN "id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "templates" ALTER COLUMN "workflow_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "email" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "stripe_customer_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "user_stats" ALTER COLUMN "id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "user_stats" ALTER COLUMN "user_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "verification" ALTER COLUMN "id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "verification" ALTER COLUMN "identifier" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "verification" ALTER COLUMN "value" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "waitlist" ALTER COLUMN "id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "waitlist" ALTER COLUMN "email" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "waitlist" ALTER COLUMN "status" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "waitlist" ALTER COLUMN "status" SET DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE "webhook" ALTER COLUMN "id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "webhook" ALTER COLUMN "workflow_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "webhook" ALTER COLUMN "block_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "webhook" ALTER COLUMN "path" SET DATA TYPE varchar(1024);--> statement-breakpoint
ALTER TABLE "webhook" ALTER COLUMN "provider" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "webhook" ALTER COLUMN "credential_set_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "workflow" ALTER COLUMN "id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "workflow" ALTER COLUMN "user_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "workflow" ALTER COLUMN "workspace_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "workflow" ALTER COLUMN "folder_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "workflow_blocks" ALTER COLUMN "id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "workflow_blocks" ALTER COLUMN "workflow_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "workflow_checkpoints" ALTER COLUMN "id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "workflow_checkpoints" ALTER COLUMN "id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "workflow_checkpoints" ALTER COLUMN "user_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "workflow_checkpoints" ALTER COLUMN "workflow_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "workflow_deployment_version" ALTER COLUMN "id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "workflow_deployment_version" ALTER COLUMN "workflow_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "workflow_edges" ALTER COLUMN "id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "workflow_edges" ALTER COLUMN "workflow_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "workflow_edges" ALTER COLUMN "source_block_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "workflow_edges" ALTER COLUMN "target_block_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "workflow_edges" ALTER COLUMN "source_handle" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "workflow_edges" ALTER COLUMN "target_handle" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "workflow_execution_logs" ALTER COLUMN "id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "workflow_execution_logs" ALTER COLUMN "workflow_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "workflow_execution_logs" ALTER COLUMN "workspace_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "workflow_execution_logs" ALTER COLUMN "execution_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "workflow_execution_logs" ALTER COLUMN "state_snapshot_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "workflow_execution_logs" ALTER COLUMN "deployment_version_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "workflow_execution_logs" ALTER COLUMN "level" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "workflow_execution_logs" ALTER COLUMN "status" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "workflow_execution_logs" ALTER COLUMN "status" SET DEFAULT 'running';--> statement-breakpoint
ALTER TABLE "workflow_execution_logs" ALTER COLUMN "trigger" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "workflow_execution_snapshots" ALTER COLUMN "id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "workflow_execution_snapshots" ALTER COLUMN "workflow_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "workflow_execution_snapshots" ALTER COLUMN "state_hash" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "workflow_folder" ALTER COLUMN "id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "workflow_folder" ALTER COLUMN "user_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "workflow_folder" ALTER COLUMN "workspace_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "workflow_folder" ALTER COLUMN "parent_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "workflow_mcp_server" ALTER COLUMN "id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "workflow_mcp_server" ALTER COLUMN "workspace_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "workflow_mcp_server" ALTER COLUMN "created_by" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "workflow_mcp_tool" ALTER COLUMN "id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "workflow_mcp_tool" ALTER COLUMN "server_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "workflow_mcp_tool" ALTER COLUMN "workflow_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "workflow_schedule" ALTER COLUMN "id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "workflow_schedule" ALTER COLUMN "workflow_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "workflow_schedule" ALTER COLUMN "block_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "workflow_schedule" ALTER COLUMN "cron_expression" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "workflow_schedule" ALTER COLUMN "trigger_type" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "workflow_schedule" ALTER COLUMN "timezone" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "workflow_schedule" ALTER COLUMN "timezone" SET DEFAULT 'UTC';--> statement-breakpoint
ALTER TABLE "workflow_schedule" ALTER COLUMN "status" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "workflow_schedule" ALTER COLUMN "status" SET DEFAULT 'active';--> statement-breakpoint
ALTER TABLE "workflow_subflows" ALTER COLUMN "id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "workflow_subflows" ALTER COLUMN "workflow_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "workflow_subflows" ALTER COLUMN "type" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "workspace" ALTER COLUMN "id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "workspace" ALTER COLUMN "owner_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "workspace" ALTER COLUMN "billed_account_user_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "workspace_byok_keys" ALTER COLUMN "id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "workspace_byok_keys" ALTER COLUMN "workspace_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "workspace_byok_keys" ALTER COLUMN "provider_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "workspace_byok_keys" ALTER COLUMN "created_by" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "workspace_environment" ALTER COLUMN "id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "workspace_environment" ALTER COLUMN "workspace_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "workspace_file" ALTER COLUMN "id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "workspace_file" ALTER COLUMN "workspace_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "workspace_file" ALTER COLUMN "key" SET DATA TYPE varchar(1024);--> statement-breakpoint
ALTER TABLE "workspace_file" ALTER COLUMN "uploaded_by" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "workspace_files" ALTER COLUMN "id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "workspace_files" ALTER COLUMN "key" SET DATA TYPE varchar(1024);--> statement-breakpoint
ALTER TABLE "workspace_files" ALTER COLUMN "user_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "workspace_files" ALTER COLUMN "workspace_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "workspace_files" ALTER COLUMN "context" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "workspace_files" ALTER COLUMN "content_type" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "workspace_invitation" ALTER COLUMN "id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "workspace_invitation" ALTER COLUMN "workspace_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "workspace_invitation" ALTER COLUMN "email" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "workspace_invitation" ALTER COLUMN "inviter_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "workspace_invitation" ALTER COLUMN "role" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "workspace_invitation" ALTER COLUMN "role" SET DEFAULT 'member';--> statement-breakpoint
ALTER TABLE "workspace_invitation" ALTER COLUMN "token" SET DATA TYPE varchar(1024);--> statement-breakpoint
ALTER TABLE "workspace_invitation" ALTER COLUMN "org_invitation_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "workspace_notification_delivery" ALTER COLUMN "id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "workspace_notification_delivery" ALTER COLUMN "subscription_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "workspace_notification_delivery" ALTER COLUMN "workflow_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "workspace_notification_delivery" ALTER COLUMN "execution_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "workspace_notification_subscription" ALTER COLUMN "id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "workspace_notification_subscription" ALTER COLUMN "workspace_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "workspace_notification_subscription" ALTER COLUMN "created_by" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "idempotency_key" ADD CONSTRAINT "idempotency_key_namespace_key_pk" PRIMARY KEY("namespace","key");--> statement-breakpoint
ALTER TABLE "a2a_agent" ADD COLUMN "agent_name" text NOT NULL;--> statement-breakpoint
ALTER TABLE "a2a_agent" ADD COLUMN "protocol" varchar(255) DEFAULT 'a2a' NOT NULL;--> statement-breakpoint
ALTER TABLE "a2a_agent" ADD COLUMN "endpoint_url" varchar(1024) NOT NULL;--> statement-breakpoint
ALTER TABLE "a2a_agent" ADD COLUMN "api_key" text;--> statement-breakpoint
ALTER TABLE "a2a_agent" ADD COLUMN "status" varchar(255) DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "a2a_task" ADD COLUMN "workspace_id" varchar(255) NOT NULL;--> statement-breakpoint
ALTER TABLE "a2a_task" ADD COLUMN "task_type" varchar(255) NOT NULL;--> statement-breakpoint
ALTER TABLE "a2a_task" ADD COLUMN "input" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "a2a_task" ADD COLUMN "output" jsonb;--> statement-breakpoint
ALTER TABLE "a2a_task" ADD COLUMN "error" text;--> statement-breakpoint
ALTER TABLE "a2a_task" ADD COLUMN "started_at" timestamp;--> statement-breakpoint
ALTER TABLE "copilot_feedback" ADD COLUMN "message_id" varchar(255) NOT NULL;--> statement-breakpoint
ALTER TABLE "copilot_feedback" ADD COLUMN "rating" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "copilot_feedback" ADD COLUMN "feedback_text" text;--> statement-breakpoint
ALTER TABLE "copilot_feedback" ADD COLUMN "metadata" jsonb;--> statement-breakpoint
ALTER TABLE "credential_set" ADD COLUMN "workspace_id" varchar(255) NOT NULL;--> statement-breakpoint
ALTER TABLE "credential_set" ADD COLUMN "config" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "credential_set" ADD COLUMN "encrypted_credentials" text;--> statement-breakpoint
ALTER TABLE "credential_set" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "credential_set_invitation" ADD COLUMN "inviter_id" varchar(255) NOT NULL;--> statement-breakpoint
ALTER TABLE "credential_set_invitation" ADD COLUMN "role" varchar(255) DEFAULT 'member' NOT NULL;--> statement-breakpoint
ALTER TABLE "credential_set_invitation" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "idempotency_key" ADD COLUMN "expires_at" timestamp NOT NULL;--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD COLUMN "icon" text;--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD COLUMN "status" varchar(255) DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD COLUMN "config" jsonb DEFAULT '{}';--> statement-breakpoint
ALTER TABLE "permission_group" ADD COLUMN "workspace_id" varchar(255) NOT NULL;--> statement-breakpoint
ALTER TABLE "permission_group" ADD COLUMN "permissions" jsonb DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "permission_group" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "permission_group_member" ADD COLUMN "group_id" varchar(255) NOT NULL;--> statement-breakpoint
ALTER TABLE "permission_group_member" ADD COLUMN "created_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "sso_provider" ADD COLUMN "created_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "sso_provider" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN "is_published" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN "author" text;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN "category" varchar(255);--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN "color" varchar(255) DEFAULT '#3972F6' NOT NULL;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN "use_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_checkpoints" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "workflow_checkpoints" ADD COLUMN "data" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_deployment_version" ADD COLUMN "definition" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_deployment_version" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "workflow_deployment_version" ADD COLUMN "deployed_by" varchar(255);--> statement-breakpoint
ALTER TABLE "workflow_mcp_server" ADD COLUMN "type" varchar(255) NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_mcp_server" ADD COLUMN "base_url" varchar(1024) NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_mcp_server" ADD COLUMN "api_key" text;--> statement-breakpoint
ALTER TABLE "workflow_mcp_server" ADD COLUMN "status" varchar(255) DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_mcp_tool" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "workflow_mcp_tool" ADD COLUMN "input_schema" jsonb;--> statement-breakpoint
ALTER TABLE "workflow_mcp_tool" ADD COLUMN "is_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "copilot_messages" ADD CONSTRAINT "copilot_messages_chat_id_copilot_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."copilot_chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_set_membership" ADD CONSTRAINT "credential_set_membership_credential_set_id_credential_set_id_fk" FOREIGN KEY ("credential_set_id") REFERENCES "public"."credential_set"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_set_membership" ADD CONSTRAINT "credential_set_membership_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "copilot_messages_chat_id_idx" ON "copilot_messages" USING btree ("chat_id");--> statement-breakpoint
CREATE INDEX "credential_set_membership_set_id_idx" ON "credential_set_membership" USING btree ("credential_set_id");--> statement-breakpoint
CREATE INDEX "credential_set_membership_user_id_idx" ON "credential_set_membership" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "credential_set_membership_unique_idx" ON "credential_set_membership" USING btree ("credential_set_id","user_id");--> statement-breakpoint
ALTER TABLE "a2a_task" ADD CONSTRAINT "a2a_task_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_set" ADD CONSTRAINT "credential_set_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_set_invitation" ADD CONSTRAINT "credential_set_invitation_inviter_id_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_group" ADD CONSTRAINT "permission_group_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_group_member" ADD CONSTRAINT "permission_group_member_group_id_permission_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."permission_group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_deployment_version" ADD CONSTRAINT "workflow_deployment_version_deployed_by_user_id_fk" FOREIGN KEY ("deployed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "a2a_agent_status_idx" ON "a2a_agent" USING btree ("status");--> statement-breakpoint
CREATE INDEX "a2a_task_workspace_id_idx" ON "a2a_task" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "copilot_feedback_message_id_idx" ON "copilot_feedback" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "credential_set_workspace_id_idx" ON "credential_set" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "credential_set_invitation_email_idx" ON "credential_set_invitation" USING btree ("email");--> statement-breakpoint
CREATE INDEX "docs_chunk_text_fts_idx" ON "docs_embeddings" USING gin ("chunk_text_tsv");--> statement-breakpoint
CREATE INDEX "docs_metadata_idx" ON "docs_embeddings" USING gin ("metadata");--> statement-breakpoint
CREATE INDEX "idempotency_key_expires_at_idx" ON "idempotency_key" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "mcp_servers_workspace_id_idx" ON "mcp_servers" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "mcp_servers_status_idx" ON "mcp_servers" USING btree ("status");--> statement-breakpoint
CREATE INDEX "permission_group_workspace_id_idx" ON "permission_group" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "permission_group_member_user_id_idx" ON "permission_group_member" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "permission_group_member_unique_idx" ON "permission_group_member" USING btree ("group_id","user_id");--> statement-breakpoint
CREATE INDEX "sso_provider_issuer_idx" ON "sso_provider" USING btree ("issuer");--> statement-breakpoint
CREATE UNIQUE INDEX "template_stars_unique_idx" ON "template_stars" USING btree ("user_id","template_id");--> statement-breakpoint
CREATE INDEX "templates_category_idx" ON "templates" USING btree ("category");--> statement-breakpoint
CREATE INDEX "templates_is_published_idx" ON "templates" USING btree ("is_published");--> statement-breakpoint
CREATE INDEX "workflow_deployment_workflow_id_idx" ON "workflow_deployment_version" USING btree ("workflow_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_deployment_workflow_version_unique" ON "workflow_deployment_version" USING btree ("workflow_id","version");--> statement-breakpoint
CREATE INDEX "workflow_mcp_server_status_idx" ON "workflow_mcp_server" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_mcp_tool_unique_idx" ON "workflow_mcp_tool" USING btree ("workflow_id","tool_name");--> statement-breakpoint
CREATE INDEX "permission_group_member_group_id_idx" ON "permission_group_member" USING btree ("group_id");--> statement-breakpoint
ALTER TABLE "a2a_agent" DROP COLUMN "name";--> statement-breakpoint
ALTER TABLE "a2a_agent" DROP COLUMN "version";--> statement-breakpoint
ALTER TABLE "a2a_agent" DROP COLUMN "capabilities";--> statement-breakpoint
ALTER TABLE "a2a_agent" DROP COLUMN "skills";--> statement-breakpoint
ALTER TABLE "a2a_agent" DROP COLUMN "authentication";--> statement-breakpoint
ALTER TABLE "a2a_agent" DROP COLUMN "signatures";--> statement-breakpoint
ALTER TABLE "a2a_agent" DROP COLUMN "is_published";--> statement-breakpoint
ALTER TABLE "a2a_agent" DROP COLUMN "published_at";--> statement-breakpoint
ALTER TABLE "a2a_task" DROP COLUMN "session_id";--> statement-breakpoint
ALTER TABLE "a2a_task" DROP COLUMN "messages";--> statement-breakpoint
ALTER TABLE "a2a_task" DROP COLUMN "artifacts";--> statement-breakpoint
ALTER TABLE "a2a_task" DROP COLUMN "execution_id";--> statement-breakpoint
ALTER TABLE "a2a_task" DROP COLUMN "metadata";--> statement-breakpoint
ALTER TABLE "copilot_chats" DROP COLUMN "messages";--> statement-breakpoint
ALTER TABLE "copilot_chats" DROP COLUMN "model";--> statement-breakpoint
ALTER TABLE "copilot_chats" DROP COLUMN "conversation_id";--> statement-breakpoint
ALTER TABLE "copilot_chats" DROP COLUMN "preview_yaml";--> statement-breakpoint
ALTER TABLE "copilot_chats" DROP COLUMN "plan_artifact";--> statement-breakpoint
ALTER TABLE "copilot_chats" DROP COLUMN "config";--> statement-breakpoint
ALTER TABLE "copilot_feedback" DROP COLUMN "chat_id";--> statement-breakpoint
ALTER TABLE "copilot_feedback" DROP COLUMN "user_query";--> statement-breakpoint
ALTER TABLE "copilot_feedback" DROP COLUMN "agent_response";--> statement-breakpoint
ALTER TABLE "copilot_feedback" DROP COLUMN "is_positive";--> statement-breakpoint
ALTER TABLE "copilot_feedback" DROP COLUMN "feedback";--> statement-breakpoint
ALTER TABLE "copilot_feedback" DROP COLUMN "workflow_yaml";--> statement-breakpoint
ALTER TABLE "copilot_feedback" DROP COLUMN "updated_at";--> statement-breakpoint
ALTER TABLE "credential_set" DROP COLUMN "organization_id";--> statement-breakpoint
ALTER TABLE "credential_set" DROP COLUMN "created_by";--> statement-breakpoint
ALTER TABLE "credential_set_invitation" DROP COLUMN "invited_by";--> statement-breakpoint
ALTER TABLE "credential_set_invitation" DROP COLUMN "accepted_at";--> statement-breakpoint
ALTER TABLE "credential_set_invitation" DROP COLUMN "accepted_by_user_id";--> statement-breakpoint
ALTER TABLE "docs_embeddings" DROP COLUMN "created_at";--> statement-breakpoint
ALTER TABLE "docs_embeddings" DROP COLUMN "updated_at";--> statement-breakpoint
ALTER TABLE "mcp_servers" DROP COLUMN "created_by";--> statement-breakpoint
ALTER TABLE "mcp_servers" DROP COLUMN "transport";--> statement-breakpoint
ALTER TABLE "mcp_servers" DROP COLUMN "headers";--> statement-breakpoint
ALTER TABLE "mcp_servers" DROP COLUMN "timeout";--> statement-breakpoint
ALTER TABLE "mcp_servers" DROP COLUMN "retries";--> statement-breakpoint
ALTER TABLE "mcp_servers" DROP COLUMN "enabled";--> statement-breakpoint
ALTER TABLE "mcp_servers" DROP COLUMN "last_connected";--> statement-breakpoint
ALTER TABLE "mcp_servers" DROP COLUMN "connection_status";--> statement-breakpoint
ALTER TABLE "mcp_servers" DROP COLUMN "last_error";--> statement-breakpoint
ALTER TABLE "mcp_servers" DROP COLUMN "status_config";--> statement-breakpoint
ALTER TABLE "mcp_servers" DROP COLUMN "tool_count";--> statement-breakpoint
ALTER TABLE "mcp_servers" DROP COLUMN "last_tools_refresh";--> statement-breakpoint
ALTER TABLE "mcp_servers" DROP COLUMN "total_requests";--> statement-breakpoint
ALTER TABLE "mcp_servers" DROP COLUMN "last_used";--> statement-breakpoint
ALTER TABLE "mcp_servers" DROP COLUMN "deleted_at";--> statement-breakpoint
ALTER TABLE "permission_group" DROP COLUMN "organization_id";--> statement-breakpoint
ALTER TABLE "permission_group" DROP COLUMN "config";--> statement-breakpoint
ALTER TABLE "permission_group" DROP COLUMN "created_by";--> statement-breakpoint
ALTER TABLE "permission_group_member" DROP COLUMN "permission_group_id";--> statement-breakpoint
ALTER TABLE "permission_group_member" DROP COLUMN "assigned_by";--> statement-breakpoint
ALTER TABLE "permission_group_member" DROP COLUMN "assigned_at";--> statement-breakpoint
ALTER TABLE "sso_provider" DROP COLUMN "organization_id";--> statement-breakpoint
ALTER TABLE "template_stars" DROP COLUMN "starred_at";--> statement-breakpoint
ALTER TABLE "templates" DROP COLUMN "creator_id";--> statement-breakpoint
ALTER TABLE "templates" DROP COLUMN "views";--> statement-breakpoint
ALTER TABLE "templates" DROP COLUMN "stars";--> statement-breakpoint
ALTER TABLE "templates" DROP COLUMN "status";--> statement-breakpoint
ALTER TABLE "templates" DROP COLUMN "tags";--> statement-breakpoint
ALTER TABLE "templates" DROP COLUMN "required_credentials";--> statement-breakpoint
ALTER TABLE "templates" DROP COLUMN "state";--> statement-breakpoint
ALTER TABLE "templates" DROP COLUMN "og_image_url";--> statement-breakpoint
ALTER TABLE "workflow_checkpoints" DROP COLUMN "chat_id";--> statement-breakpoint
ALTER TABLE "workflow_checkpoints" DROP COLUMN "message_id";--> statement-breakpoint
ALTER TABLE "workflow_checkpoints" DROP COLUMN "workflow_state";--> statement-breakpoint
ALTER TABLE "workflow_checkpoints" DROP COLUMN "updated_at";--> statement-breakpoint
ALTER TABLE "workflow_deployment_version" DROP COLUMN "name";--> statement-breakpoint
ALTER TABLE "workflow_deployment_version" DROP COLUMN "state";--> statement-breakpoint
ALTER TABLE "workflow_deployment_version" DROP COLUMN "is_active";--> statement-breakpoint
ALTER TABLE "workflow_deployment_version" DROP COLUMN "created_by";--> statement-breakpoint
ALTER TABLE "workflow_mcp_tool" DROP COLUMN "tool_description";--> statement-breakpoint
ALTER TABLE "workflow_mcp_tool" DROP COLUMN "parameter_schema";--> statement-breakpoint
DROP TYPE "public"."a2a_task_status";--> statement-breakpoint
DROP TYPE "public"."credential_set_invitation_status";--> statement-breakpoint
DROP TYPE "public"."credential_set_member_status";--> statement-breakpoint
DROP TYPE "public"."template_creator_type";--> statement-breakpoint
DROP TYPE "public"."template_status";--> statement-breakpoint
DROP TYPE "public"."usage_log_category";--> statement-breakpoint
DROP TYPE "public"."usage_log_source";