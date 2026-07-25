import { db } from '@sim/db'
import { workflow } from '@sim/db/schema'
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { WorkflowListItem } from '@/lib/api/contracts/workflows'
import { listAccessibleWorkspaceRowsForUser } from '@/lib/workspaces/utils'

type WorkflowListScope = 'active' | 'archived' | 'all'

/**
 * Project only the columns declared in `workflowListItemSchema` so the result
 * matches the contract wire shape exactly. The full row is larger (`state`,
 * `variables`, `apiKey`, `runCount`, etc.) and would be dropped by the client
 * Zod parse anyway — narrowing here keeps the payload small. Keep aligned with
 * the contract.
 */
const listColumns = {
  id: workflow.id,
  name: workflow.name,
  description: workflow.description,
  workspaceId: workflow.workspaceId,
  folderId: workflow.folderId,
  sortOrder: workflow.sortOrder,
  createdAt: workflow.createdAt,
  updatedAt: workflow.updatedAt,
  archivedAt: workflow.archivedAt,
  locked: workflow.locked,
  forkSyncExcluded: workflow.forkSyncExcluded,
  isDeployed: workflow.isDeployed,
} as const

const orderByClause = [asc(workflow.sortOrder), asc(workflow.createdAt), asc(workflow.id)]

type WorkflowListRow = {
  id: string
  name: string
  description: string | null
  workspaceId: string | null
  folderId: string | null
  sortOrder: number
  createdAt: Date
  updatedAt: Date
  archivedAt: Date | null
  locked: boolean
  forkSyncExcluded: boolean
  isDeployed: boolean
}

/** Normalizes timestamp columns to ISO strings to honor the `WorkflowListItem` wire contract. */
function toListItem(row: WorkflowListRow): WorkflowListItem {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
  }
}

function scopeCondition(
  scope: WorkflowListScope,
  base: ReturnType<typeof eq> | ReturnType<typeof inArray>
) {
  if (scope === 'all') return base
  if (scope === 'archived') return and(base, sql`${workflow.archivedAt} IS NOT NULL`)
  return and(base, isNull(workflow.archivedAt))
}

/**
 * Lists workflows visible to a user as the contract wire shape, shared by the
 * `GET /api/workflows` route and the workspace sidebar prefetch. Performs no auth
 * or membership checks — callers enforce access before invoking.
 *
 * With `workspaceId`, returns that workspace's workflows; without it, returns
 * workflows across every workspace the user has permissions on.
 */
export async function listWorkflowsForUser({
  userId,
  workspaceId,
  scope,
}: {
  userId: string
  workspaceId?: string
  scope: WorkflowListScope
}): Promise<WorkflowListItem[]> {
  if (workspaceId) {
    const rows = await db
      .select(listColumns)
      .from(workflow)
      .where(scopeCondition(scope, eq(workflow.workspaceId, workspaceId)))
      .orderBy(...orderByClause)
    return rows.map(toListItem)
  }

  const accessibleRows = await listAccessibleWorkspaceRowsForUser(userId, 'all')
  const workspaceIds = accessibleRows.map((row) => row.workspace.id)
  if (workspaceIds.length === 0) return []

  const rows = await db
    .select(listColumns)
    .from(workflow)
    .where(scopeCondition(scope, inArray(workflow.workspaceId, workspaceIds)))
    .orderBy(...orderByClause)
  return rows.map(toListItem)
}
