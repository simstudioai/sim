-- Admits the search_people Search MCP tool in activity rows. NOT VALID swaps the check as a metadata
-- change in one statement, so no insert sees the table without one. The COMMIT releases that
-- statement's ACCESS EXCLUSIVE lock before VALIDATE scans the table under a lock that does not block
-- writes. Replay-safe: the drop is IF EXISTS, the re-added check is identical, and validating twice
-- is harmless.
-- migration-safe: only widens the allowed tool names; every row the deployed app writes still satisfies the check.
ALTER TABLE "organization_search_mcp_invocation"
  DROP CONSTRAINT IF EXISTS "organization_search_mcp_invocation_tool_check",
  ADD CONSTRAINT "organization_search_mcp_invocation_tool_check" CHECK ("organization_search_mcp_invocation"."tool_name" IN ('search', 'read_document', 'chat', 'search_people')) NOT VALID;--> statement-breakpoint
COMMIT;--> statement-breakpoint
ALTER TABLE "organization_search_mcp_invocation" VALIDATE CONSTRAINT "organization_search_mcp_invocation_tool_check";
