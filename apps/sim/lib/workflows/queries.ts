import { db } from '@sim/db'
import { workflow } from '@sim/db/schema'
import { and, asc, eq, inArray, isNotNull, isNull, type SQL, sql } from 'drizzle-orm'
import type { WorkflowListItem } from '@/lib/api/contracts/workflows'
import {
  type CursorKey,
  type KeysetKey,
  keysetColumns,
  keysetPage,
  type ListSortOrder,
  listOrderBy,
  numberKey,
  resumeKeyset,
  searchFilter,
  textKey,
  timestampKey,
} from '@/lib/api/list-query'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/persistence/utils'
import { listAccessibleWorkspaceRowsForUser } from '@/lib/workspaces/utils'

type WorkflowListScope = 'active' | 'archived' | 'all'

export type WorkflowSortBy = 'position' | 'name' | 'createdAt' | 'updatedAt' | 'runCount'
export type WorkflowSortOrder = ListSortOrder

export interface WorkspaceWorkflowListRow {
  id: string
  name: string
  description: string | null
  folderId: string | null
  workspaceId: string | null
  isDeployed: boolean
  deployedAt: Date | null
  runCount: number
  lastRunAt: Date | null
  sortOrder: number
  createdAt: Date
  updatedAt: Date
}

const workspaceWorkflowId = textKey<WorkspaceWorkflowListRow>(workflow.id, (row) => row.id)
const workspaceWorkflowCreatedAt = timestampKey<WorkspaceWorkflowListRow>(
  workflow.createdAt,
  (row) => row.createdAt
)

const WORKFLOW_SORTS = {
  position: [
    numberKey<WorkspaceWorkflowListRow>(workflow.sortOrder, (row) => row.sortOrder),
    workspaceWorkflowCreatedAt,
    workspaceWorkflowId,
  ],
  name: [textKey<WorkspaceWorkflowListRow>(workflow.name, (row) => row.name), workspaceWorkflowId],
  createdAt: [workspaceWorkflowCreatedAt, workspaceWorkflowId],
  updatedAt: [
    timestampKey<WorkspaceWorkflowListRow>(workflow.updatedAt, (row) => row.updatedAt),
    workspaceWorkflowId,
  ],
  runCount: [
    numberKey<WorkspaceWorkflowListRow>(workflow.runCount, (row) => row.runCount),
    workspaceWorkflowId,
  ],
} satisfies Record<WorkflowSortBy, readonly KeysetKey<WorkspaceWorkflowListRow>[]>

export interface ListWorkspaceWorkflowsInput {
  workspaceId: string
  folderId?: string | null
  /** `active` (default) or `archived`; `all` is deliberately unavailable here. */
  scope?: 'active' | 'archived'
  deployedOnly: boolean
  search?: string
  sortBy: WorkflowSortBy
  sortOrder: WorkflowSortOrder
  cursorKeys?: CursorKey[]
  limit: number
}

/** Cursor-paged active workflow query used by the public workflow adapter. */
export async function listWorkspaceWorkflows(input: ListWorkspaceWorkflowsInput) {
  const keys = WORKFLOW_SORTS[input.sortBy]
  const resumeAfter = resumeKeyset(keys, input.cursorKeys, input.sortOrder)

  const folderCondition: SQL | undefined =
    input.folderId === undefined
      ? undefined
      : input.folderId === null
        ? isNull(workflow.folderId)
        : eq(workflow.folderId, input.folderId)

  const rows = await db
    .select({
      id: workflow.id,
      name: workflow.name,
      description: workflow.description,
      folderId: workflow.folderId,
      workspaceId: workflow.workspaceId,
      isDeployed: workflow.isDeployed,
      deployedAt: workflow.deployedAt,
      runCount: workflow.runCount,
      lastRunAt: workflow.lastRunAt,
      sortOrder: workflow.sortOrder,
      createdAt: workflow.createdAt,
      updatedAt: workflow.updatedAt,
    })
    .from(workflow)
    .where(
      and(
        eq(workflow.workspaceId, input.workspaceId),
        input.scope === 'archived' ? isNotNull(workflow.archivedAt) : isNull(workflow.archivedAt),
        folderCondition,
        input.deployedOnly ? eq(workflow.isDeployed, true) : undefined,
        searchFilter(workflow.name, input.search),
        resumeAfter
      )
    )
    .orderBy(...listOrderBy(keysetColumns(keys), input.sortOrder))
    .limit(input.limit + 1)

  return keysetPage(keys, rows, input.limit)
}

/**
 * Loads one consistent workflow record + normalized definition snapshot. Both
 * the editor route and public metadata route derive their own response from
 * this read rather than issuing independent block/workflow queries.
 */
export async function loadWorkflowReadSnapshot(workflowId: string, workspaceId: string) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`)
    const [normalizedData, [workflowRecord]] = await Promise.all([
      loadWorkflowFromNormalizedTables(workflowId, tx),
      tx
        .select()
        .from(workflow)
        .where(
          and(
            eq(workflow.id, workflowId),
            eq(workflow.workspaceId, workspaceId),
            isNull(workflow.archivedAt)
          )
        )
        .limit(1),
    ])
    return { normalizedData, workflowRecord: workflowRecord ?? null }
  })
}

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
