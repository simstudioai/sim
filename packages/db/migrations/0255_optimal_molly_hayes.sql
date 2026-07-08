-- migration-safe: additive enum value only (no rewrite, no table lock); old app code never
-- reads or writes 'workflow_mcp_server' rows, so it is invisible during cutover
ALTER TYPE "public"."workspace_fork_resource_type" ADD VALUE 'workflow_mcp_server' BEFORE 'custom_tool';