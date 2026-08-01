import { db } from '@sim/db'
import { mcpServers } from '@sim/db/schema'
import { and, desc, eq, isNull } from 'drizzle-orm'

/**
 * Workspace-scoped MCP server reads. The lifecycle functions in
 * `lib/mcp/orchestration` cover the write paths; these cover the read paths the
 * public API needs without duplicating the scoping predicate per route.
 */

export type McpServerRow = typeof mcpServers.$inferSelect

/** Live (non-soft-deleted) MCP servers in a workspace, newest first. */
export async function listWorkspaceMcpServers(params: {
  workspaceId: string
}): Promise<McpServerRow[]> {
  return db
    .select()
    .from(mcpServers)
    .where(and(eq(mcpServers.workspaceId, params.workspaceId), isNull(mcpServers.deletedAt)))
    .orderBy(desc(mcpServers.createdAt))
}

/** A single live MCP server, or null when it does not exist in this workspace. */
export async function getWorkspaceMcpServer(params: {
  workspaceId: string
  serverId: string
}): Promise<McpServerRow | null> {
  const [row] = await db
    .select()
    .from(mcpServers)
    .where(
      and(
        eq(mcpServers.id, params.serverId),
        eq(mcpServers.workspaceId, params.workspaceId),
        isNull(mcpServers.deletedAt)
      )
    )
    .limit(1)
  return row ?? null
}

/**
 * The state of the row occupying the deterministic id derived from a workspace
 * and URL, or null when the id is free.
 *
 * The soft-deleted case has to be distinguished rather than merged into "taken":
 * `performCreateMcpServer` revives such a row instead of inserting alongside it,
 * so reporting it as a duplicate would make a soft-deleted URL permanently
 * unusable — it cannot be fetched or patched either, since those resolve live
 * rows only.
 */
export async function getMcpServerIdState(params: {
  workspaceId: string
  serverId: string
}): Promise<{ deleted: boolean } | null> {
  const [row] = await db
    .select({ deletedAt: mcpServers.deletedAt })
    .from(mcpServers)
    .where(and(eq(mcpServers.id, params.serverId), eq(mcpServers.workspaceId, params.workspaceId)))
    .limit(1)
  return row ? { deleted: row.deletedAt !== null } : null
}
