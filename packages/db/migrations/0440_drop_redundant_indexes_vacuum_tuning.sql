-- Replay-safety: this file ends in CONCURRENTLY index drops below an embedded COMMIT, so a
-- failure there replays the whole file from the top. Every statement here is idempotent: the
-- reloption changes set fixed values, and each drop is IF EXISTS. A drop interrupted mid-way
-- leaves its index invalid, and the replay's DROP INDEX CONCURRENTLY IF EXISTS removes it.
--
-- migration-safe: table-local maintenance settings only; a catalog update under SHARE UPDATE EXCLUSIVE, which reads and writes do not wait on, with no row rewrite.
-- These tables churn faster than the default 20% scale factors trigger on: embedding through
-- document re-chunking deletes and inserts, workspace_files through inserts and non-HOT updates,
-- and copilot_async_tool_calls through status updates. Vacuuming after 2% of rows are dead or
-- newly inserted keeps the visibility map current for index-only scans and bounds index bloat.
-- embedding keeps 0431's cost throttle, so each run stays rate-limited, just smaller and sooner.
-- embedding_search is left at the defaults: each vacuum there also scans its HNSW index.
ALTER TABLE "embedding" SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_insert_scale_factor = 0.02);--> statement-breakpoint
ALTER TABLE "workspace_files" SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_insert_scale_factor = 0.02);--> statement-breakpoint
ALTER TABLE "copilot_async_tool_calls" SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_insert_scale_factor = 0.02);--> statement-breakpoint
COMMIT;--> statement-breakpoint
SET lock_timeout = 0;--> statement-breakpoint
-- Each index dropped below is a leading-column prefix of another b-tree on the same table with
-- no predicate, so that index serves every lookup, range scan and foreign-key check the dropped
-- one did. The coverer is named beside each drop.
-- copilot_async_tool_calls_run_status_idx (run_id, status)
DROP INDEX CONCURRENTLY IF EXISTS "copilot_async_tool_calls_run_id_idx";--> statement-breakpoint
-- copilot_chats_user_workflow_idx (user_id, workflow_id), among others leading with user_id
DROP INDEX CONCURRENTLY IF EXISTS "copilot_chats_user_id_idx";--> statement-breakpoint
-- copilot_run_checkpoints_run_pending_tool_unique (run_id, pending_tool_call_id)
DROP INDEX CONCURRENTLY IF EXISTS "copilot_run_checkpoints_run_id_idx";--> statement-breakpoint
-- copilot_runs_chat_started_at_idx (chat_id, started_at)
DROP INDEX CONCURRENTLY IF EXISTS "copilot_runs_chat_id_idx";--> statement-breakpoint
-- copilot_runs_workspace_completed_at_id_idx (workspace_id, date_trunc(completed_at), id)
DROP INDEX CONCURRENTLY IF EXISTS "copilot_runs_workspace_id_idx";--> statement-breakpoint
-- credential_group_organization_unique (organization_id)
DROP INDEX CONCURRENTLY IF EXISTS "credential_group_organization_id_idx";--> statement-breakpoint
-- custom_block_organization_type_unique (organization_id, type)
DROP INDEX CONCURRENTLY IF EXISTS "custom_block_organization_id_idx";--> statement-breakpoint
-- custom_tools_workspace_title_unique (workspace_id, title)
DROP INDEX CONCURRENTLY IF EXISTS "custom_tools_workspace_id_idx";--> statement-breakpoint
-- data_drains_org_name_unique (organization_id, name)
DROP INDEX CONCURRENTLY IF EXISTS "data_drains_org_idx";--> statement-breakpoint
-- doc_processing_status_idx (knowledge_base_id, processing_status)
DROP INDEX CONCURRENTLY IF EXISTS "doc_kb_id_idx";--> statement-breakpoint
-- kb_user_workspace_idx (user_id, workspace_id)
DROP INDEX CONCURRENTLY IF EXISTS "kb_user_id_idx";--> statement-breakpoint
-- kb_tag_definitions_kb_slot_idx (knowledge_base_id, tag_slot)
DROP INDEX CONCURRENTLY IF EXISTS "kb_tag_definitions_kb_id_idx";--> statement-breakpoint
-- ked_organization_identity_unique (organization_id, provider_id, tenant_id)
DROP INDEX CONCURRENTLY IF EXISTS "ked_organization_id_idx";--> statement-breakpoint
-- keg_organization_identity_unique (organization_id, provider_id, tenant_id, external_group_id)
DROP INDEX CONCURRENTLY IF EXISTS "keg_organization_id_idx";--> statement-breakpoint
-- memory_workspace_key_idx (workspace_id, key)
DROP INDEX CONCURRENTLY IF EXISTS "memory_workspace_idx";--> statement-breakpoint
-- permission_group_member_group_user_unique (permission_group_id, user_id)
DROP INDEX CONCURRENTLY IF EXISTS "permission_group_member_group_id_idx";--> statement-breakpoint
-- permissions_unique_constraint (user_id, entity_type, entity_id) covers both permissions drops
DROP INDEX CONCURRENTLY IF EXISTS "permissions_user_id_idx";--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS "permissions_user_entity_type_idx";--> statement-breakpoint
-- scim_group_mapping_group_target_unique (group_id, target_kind, coalesce(...))
DROP INDEX CONCURRENTLY IF EXISTS "scim_group_mapping_group_idx";--> statement-breakpoint
-- sso_domain_org_domain_unique (organization_id, domain)
DROP INDEX CONCURRENTLY IF EXISTS "sso_domain_organization_id_idx";--> statement-breakpoint
-- workflow_user_workspace_idx (user_id, workspace_id)
DROP INDEX CONCURRENTLY IF EXISTS "workflow_user_id_idx";--> statement-breakpoint
-- workflow_checkpoints_user_workflow_idx (user_id, workflow_id)
DROP INDEX CONCURRENTLY IF EXISTS "workflow_checkpoints_user_id_idx";--> statement-breakpoint
-- workflow_checkpoints_workflow_chat_idx (workflow_id, chat_id)
DROP INDEX CONCURRENTLY IF EXISTS "workflow_checkpoints_workflow_id_idx";--> statement-breakpoint
-- workflow_edges_workflow_source_idx (workflow_id, source_block_id)
DROP INDEX CONCURRENTLY IF EXISTS "workflow_edges_workflow_id_idx";--> statement-breakpoint
-- workflow_execution_logs_workflow_started_at_idx (workflow_id, started_at)
DROP INDEX CONCURRENTLY IF EXISTS "workflow_execution_logs_workflow_id_idx";--> statement-breakpoint
-- workflow_execution_logs_workspace_activity_level_idx (workspace_id, started_at, ...) keeps the
-- ascending order; workflow_execution_logs_workspace_started_at_id_desc_idx the descending one
DROP INDEX CONCURRENTLY IF EXISTS "workflow_execution_logs_workspace_started_at_idx";--> statement-breakpoint
-- workflow_snapshots_workflow_hash_idx (workflow_id, state_hash)
DROP INDEX CONCURRENTLY IF EXISTS "workflow_snapshots_workflow_id_idx";--> statement-breakpoint
-- workflow_subflows_workflow_type_idx (workflow_id, type)
DROP INDEX CONCURRENTLY IF EXISTS "workflow_subflows_workflow_id_idx";--> statement-breakpoint
-- workspace_fork_dependent_value_field_unique (child_workspace_id, target_workflow_id, ...)
DROP INDEX CONCURRENTLY IF EXISTS "workspace_fork_dependent_value_child_ws_wf_idx";--> statement-breakpoint
-- workspace_fork_resource_map_child_type_parent_unique (child_workspace_id, resource_type,
-- parent_resource_id) covers both resource map drops
DROP INDEX CONCURRENTLY IF EXISTS "workspace_fork_resource_map_child_ws_idx";--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS "workspace_fork_resource_map_child_ws_type_idx";--> statement-breakpoint
-- workspace_sandbox_workspace_name_unique (workspace_id, name)
DROP INDEX CONCURRENTLY IF EXISTS "workspace_sandbox_workspace_idx";--> statement-breakpoint
SET lock_timeout = '5s';
