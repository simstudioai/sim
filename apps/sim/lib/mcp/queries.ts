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
 * Whether a row already occupies the deterministic id derived from a workspace
 * and URL — soft-deleted rows included, because the create path revives rather
 * than inserts alongside them. Lets a caller reject a duplicate registration
 * before the upsert in `performCreateMcpServer` overwrites the existing row.
 */
export async function mcpServerIdExists(params: {
  workspaceId: string
  serverId: string
}): Promise<boolean> {
  const [row] = await db
    .select({ id: mcpServers.id })
    .from(mcpServers)
    .where(and(eq(mcpServers.id, params.serverId), eq(mcpServers.workspaceId, params.workspaceId)))
    .limit(1)
  return Boolean(row)
}
