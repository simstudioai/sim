import { db } from '@sim/db'
import { mcpServers } from '@sim/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import {
  type CursorKey,
  type KeysetKey,
  type KeysetPage,
  keysetColumns,
  keysetPage,
  type ListSortOrder,
  listOrderBy,
  resumeKeyset,
  searchFilter,
  textKey,
  timestampKey,
} from '@/lib/api/list-query'

/**
 * Workspace-scoped MCP server reads. The lifecycle functions in
 * `lib/mcp/orchestration` cover the write paths; these cover the read paths the
 * public API needs without duplicating the scoping predicate per route.
 */

export type McpServerRow = typeof mcpServers.$inferSelect
export type McpServerSortBy = 'name' | 'createdAt' | 'updatedAt'

const mcpServerId = textKey<McpServerRow>(mcpServers.id, (row) => row.id)

/**
 * Keyset orderings for the public list's sortable fields, made total over the
 * contract enum by `satisfies`. Each ends in `id` so servers sharing a name or a
 * timestamp still come back in a stable order — which is also what makes the
 * cursor resumable, since a non-unique final key can repeat or skip a row at a
 * page boundary.
 */
const MCP_SERVER_SORTS = {
  name: [textKey<McpServerRow>(mcpServers.name, (row) => row.name), mcpServerId],
  createdAt: [
    timestampKey<McpServerRow>(mcpServers.createdAt, (row) => row.createdAt),
    mcpServerId,
  ],
  updatedAt: [
    timestampKey<McpServerRow>(mcpServers.updatedAt, (row) => row.updatedAt),
    mcpServerId,
  ],
} satisfies Record<McpServerSortBy, readonly KeysetKey<McpServerRow>[]>

/**
 * One keyset page of live (non-soft-deleted) MCP servers in a workspace.
 *
 * Nothing caps how many servers a workspace may register, so this read shipped
 * as the one unbounded v2 list; the public page is now cut by the caller's
 * `limit` like every other collection. `limit` stays optional because the
 * copilot adapter reads the whole set — an absent `limit` applies no `LIMIT`
 * clause and, per {@link keysetPage}, can never yield a cursor.
 */
export async function listWorkspaceMcpServers(params: {
  workspaceId: string
  /** Case-insensitive substring match on the server name. */
  search?: string
  sortBy?: McpServerSortBy
  sortOrder?: ListSortOrder
  limit?: number
  cursorKeys?: CursorKey[]
}): Promise<KeysetPage<McpServerRow>> {
  const { sortBy = 'createdAt', sortOrder = 'desc', limit } = params
  const keys = MCP_SERVER_SORTS[sortBy]
  const resumeAfter = resumeKeyset(keys, params.cursorKeys, sortOrder)

  const ordered = db
    .select()
    .from(mcpServers)
    .where(
      and(
        eq(mcpServers.workspaceId, params.workspaceId),
        isNull(mcpServers.deletedAt),
        searchFilter(mcpServers.name, params.search),
        resumeAfter
      )
    )
    .orderBy(...listOrderBy(keysetColumns(keys), sortOrder))

  const rows = await (limit === undefined ? ordered : ordered.limit(limit + 1))

  return keysetPage(keys, rows, limit)
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
