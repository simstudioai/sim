-- Adds the managed MCP credential type separately from the storage migration. PostgreSQL cannot
-- use a new enum label in an index predicate until the transaction that introduced it commits.
ALTER TYPE "public"."credential_type" ADD VALUE IF NOT EXISTS 'managed_mcp' BEFORE 'env_workspace';
