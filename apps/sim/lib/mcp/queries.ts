import { db } from '@sim/db'
import { mcpServers, workflow, workflowMcpServer, workflowMcpTool } from '@sim/db/schema'
import { and, asc, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm'
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

export type WorkflowMcpServerRow = typeof workflowMcpServer.$inferSelect
export type WorkflowMcpToolRow = typeof workflowMcpTool.$inferSelect
export type WorkflowMcpServerSortBy = 'name' | 'createdAt' | 'updatedAt'

const workflowMcpServerId = textKey<WorkflowMcpServerRow>(workflowMcpServer.id, (row) => row.id)

/**
 * Keyset orderings for the workflow-MCP list, mirroring {@link MCP_SERVER_SORTS}
 * so the two server families page identically. Each ends in `id` for the same
 * reason: a non-unique final key repeats or drops a row at a page boundary.
 */
const WORKFLOW_MCP_SERVER_SORTS = {
  name: [
    textKey<WorkflowMcpServerRow>(workflowMcpServer.name, (row) => row.name),
    workflowMcpServerId,
  ],
  createdAt: [
    timestampKey<WorkflowMcpServerRow>(workflowMcpServer.createdAt, (row) => row.createdAt),
    workflowMcpServerId,
  ],
  updatedAt: [
    timestampKey<WorkflowMcpServerRow>(workflowMcpServer.updatedAt, (row) => row.updatedAt),
    workflowMcpServerId,
  ],
} satisfies Record<WorkflowMcpServerSortBy, readonly KeysetKey<WorkflowMcpServerRow>[]>

/**
 * One keyset page of live workflow-MCP servers in a workspace.
 *
 * Nothing caps how many a workspace publishes, so this pages exactly like the
 * external server list. `limit` is required here rather than optional: the only
 * callers are the public list and the copilot adapter, and both bound the page.
 */
export async function listWorkspaceWorkflowMcpServers(params: {
  workspaceId: string
  sortBy?: WorkflowMcpServerSortBy
  sortOrder?: ListSortOrder
  limit: number
  cursorKeys?: CursorKey[]
}): Promise<KeysetPage<WorkflowMcpServerRow>> {
  const { sortBy = 'createdAt', sortOrder = 'desc', limit } = params
  const keys = WORKFLOW_MCP_SERVER_SORTS[sortBy]
  const resumeAfter = resumeKeyset(keys, params.cursorKeys, sortOrder)

  const rows = await db
    .select()
    .from(workflowMcpServer)
    .where(
      and(
        eq(workflowMcpServer.workspaceId, params.workspaceId),
        isNull(workflowMcpServer.deletedAt),
        resumeAfter
      )
    )
    .orderBy(...listOrderBy(keysetColumns(keys), sortOrder))
    .limit(limit + 1)

  return keysetPage(keys, rows, limit)
}

/**
 * Live tool names for a set of workflow-MCP servers, alphabetically ordered
 * within each server.
 *
 * A bounded second read rather than a join on the server page: joining would
 * multiply server rows by their tools and break the keyset page boundary. The
 * cap is on the aggregate rather than per server, so `truncated` means "some
 * server's inventory is incomplete", which is the only claim one read can
 * honestly make.
 */
export async function listWorkflowMcpToolNames(
  serverIds: string[],
  limit: number
): Promise<{ namesByServerId: Map<string, string[]>; truncated: boolean }> {
  if (serverIds.length === 0) return { namesByServerId: new Map(), truncated: false }

  const rows = await db
    .select({ serverId: workflowMcpTool.serverId, toolName: workflowMcpTool.toolName })
    .from(workflowMcpTool)
    .where(and(inArray(workflowMcpTool.serverId, serverIds), isNull(workflowMcpTool.archivedAt)))
    .orderBy(asc(workflowMcpTool.serverId), asc(workflowMcpTool.toolName))
    .limit(limit + 1)

  const namesByServerId = new Map<string, string[]>()
  for (const row of rows.slice(0, limit)) {
    const existing = namesByServerId.get(row.serverId)
    if (existing) existing.push(row.toolName)
    else namesByServerId.set(row.serverId, [row.toolName])
  }
  return { namesByServerId, truncated: rows.length > limit }
}

/** A live (non-soft-deleted) workflow-MCP server by id, or null. */
export async function getWorkflowMcpServerById(
  serverId: string
): Promise<WorkflowMcpServerRow | null> {
  const [row] = await db
    .select()
    .from(workflowMcpServer)
    .where(and(eq(workflowMcpServer.id, serverId), isNull(workflowMcpServer.deletedAt)))
    .limit(1)
  return row ?? null
}

/**
 * Every live tool a server publishes, tool-name ordered.
 *
 * Bounded by `limit` rather than paged, matching `GET /api/v2/mcp-servers/{mcpServerId}/tools`:
 * a server's inventory is capped by the workflows a workspace has deployed, and
 * the caller wants the whole inventory to reconcile against, not a page of it.
 * The `+ 1` read is how the caller learns the cap was hit — the same signal
 * {@link listWorkflowMcpToolNames} reports as `truncated`.
 */
export async function listLiveWorkflowMcpTools(
  serverId: string,
  limit: number
): Promise<{ tools: WorkflowMcpToolRow[]; truncated: boolean }> {
  const rows = await db
    .select()
    .from(workflowMcpTool)
    .where(and(eq(workflowMcpTool.serverId, serverId), isNull(workflowMcpTool.archivedAt)))
    .orderBy(asc(workflowMcpTool.toolName))
    .limit(limit + 1)
  return { tools: rows.slice(0, limit), truncated: rows.length > limit }
}

/**
 * Every tool a server publishes, archived registrations included, tool-name
 * ordered and bounded like {@link listLiveWorkflowMcpTools}.
 *
 * An undeploy archives a workflow's registrations rather than deleting them
 * (`removeMcpToolsForWorkflow`), and the next deploy brings them back. A caller
 * reconciling a server's inventory must see those rows as inactive rather than
 * as vanished — otherwise every undeploy read as a tool silently unpublished.
 */
export async function listWorkflowMcpToolsIncludingArchived(
  serverId: string,
  limit: number
): Promise<{ tools: WorkflowMcpToolRow[]; truncated: boolean }> {
  const rows = await db
    .select()
    .from(workflowMcpTool)
    .where(eq(workflowMcpTool.serverId, serverId))
    .orderBy(asc(workflowMcpTool.toolName))
    .limit(limit + 1)
  return { tools: rows.slice(0, limit), truncated: rows.length > limit }
}

/**
 * The live registrations of one workflow across every server, ordered by
 * server then tool name — exactly the set an undeploy is about to archive.
 */
export async function listLiveWorkflowMcpToolsForWorkflow(
  workflowId: string
): Promise<Array<{ serverId: string; toolName: string }>> {
  return db
    .select({ serverId: workflowMcpTool.serverId, toolName: workflowMcpTool.toolName })
    .from(workflowMcpTool)
    .where(and(eq(workflowMcpTool.workflowId, workflowId), isNull(workflowMcpTool.archivedAt)))
    .orderBy(asc(workflowMcpTool.serverId), asc(workflowMcpTool.toolName))
}

/**
 * The live tool publishing a workflow on a server, or null.
 *
 * A server carries at most one unarchived tool per workflow — the partial unique
 * index on `(server_id, workflow_id)` — so the pair is an identity, which is why
 * the public surface addresses a tool by workflow rather than by tool id.
 */

export async function getLiveWorkflowMcpTool(
  serverId: string,
  workflowId: string
): Promise<WorkflowMcpToolRow | null> {
  const [row] = await db
    .select()
    .from(workflowMcpTool)
    .where(
      and(
        eq(workflowMcpTool.serverId, serverId),
        eq(workflowMcpTool.workflowId, workflowId),
        isNull(workflowMcpTool.archivedAt)
      )
    )
    .limit(1)
  return row ?? null
}

/**
 * The registration for a workflow on a server, archived or not.
 *
 * Undeploying a workflow archives its registrations rather than destroying them
 * so a redeploy can restore them. A user withdrawing a registration on purpose
 * must still be able to do so while the workflow is undeployed — and that hard
 * delete is exactly what stops the next deploy from resurrecting it — so the
 * delete path resolves the row through this instead of
 * {@link getLiveWorkflowMcpTool}.
 */
export async function getWorkflowMcpToolIncludingArchived(
  serverId: string,
  workflowId: string
): Promise<WorkflowMcpToolRow | null> {
  const live = await getLiveWorkflowMcpTool(serverId, workflowId)
  if (live) return live

  const [archivedRow] = await db
    .select()
    .from(workflowMcpTool)
    .where(
      and(
        eq(workflowMcpTool.serverId, serverId),
        eq(workflowMcpTool.workflowId, workflowId),
        isNotNull(workflowMcpTool.archivedAt)
      )
    )
    .orderBy(desc(workflowMcpTool.archivedAt))
    .limit(1)
  return archivedRow ?? null
}

export type WorkflowMcpPublishableWorkflow = {
  id: string
  name: string
  isDeployed: boolean
}

/**
 * The workflow a workflow-MCP tool would publish, scoped to the server's own
 * workspace.
 *
 * Predicating on the workspace here is what makes a workflow id from another
 * tenant a not-found rather than a cross-tenant publish, so this read is the
 * authorization-sensitive half of resolving a tool target.
 */
export async function getWorkflowMcpPublishableWorkflow(
  workspaceId: string,
  workflowId: string
): Promise<WorkflowMcpPublishableWorkflow | null> {
  const [row] = await db
    .select({ id: workflow.id, name: workflow.name, isDeployed: workflow.isDeployed })
    .from(workflow)
    .where(
      and(
        eq(workflow.id, workflowId),
        eq(workflow.workspaceId, workspaceId),
        isNull(workflow.archivedAt)
      )
    )
    .limit(1)
  return row ?? null
}
