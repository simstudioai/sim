-- migration-safe: additive enum value only (no rewrite, no table lock, no backfill). Old app
-- code never reads or writes 'custom_block' rows — the value only becomes reachable once the
-- custom-block remapper ships — so it is invisible to the deployed version during cutover.
-- IF NOT EXISTS keeps the statement idempotent on replay.
ALTER TYPE "public"."workspace_fork_resource_type" ADD VALUE IF NOT EXISTS 'custom_block' BEFORE 'custom_tool';
