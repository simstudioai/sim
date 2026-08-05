import { db } from '@sim/db'
import { workflow } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { assertFolderMutable, FolderLockedError } from '@sim/platform-authz/workflow'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, eq, isNull } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import {
  type V2WorkflowListItem,
  type V2WorkflowSortBy,
  v2CreateWorkflowContract,
  v2ListWorkflowsContract,
} from '@/lib/api/contracts/v2/workflows'
import {
  encodeKeyset,
  type KeysetKey,
  keysetAfter,
  keysetColumns,
  listOrderBy,
  numberKey,
  searchFilter,
  textKey,
  timestampKey,
} from '@/lib/api/list-query'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { loadActiveFolderPathIndex } from '@/lib/folders/queries'
import { performCreateWorkflow } from '@/lib/workflows/orchestration'
import { checkRateLimit, resolveWorkspaceAccess } from '@/app/api/v1/middleware'
import {
  folderPathForId,
  resolveFolderPathId,
  resolveFolderPathIdentity,
} from '@/app/api/v2/lib/folders'
import { v2ApiGateError } from '@/app/api/v2/lib/gate'
import {
  cursorSortKey,
  decodeSortedCursor,
  encodeSortedCursor,
  v2CursorList,
  v2CursorSortError,
  v2Data,
  v2Error,
  v2ErrorForOrchestration,
  v2RateLimitError,
  v2ValidationError,
  v2WorkspaceAccessError,
} from '@/app/api/v2/lib/response'

const logger = createLogger('V2WorkflowsAPI')

export const dynamic = 'force-dynamic'
export const revalidate = 0

type WorkflowRow = {
  id: string
  name: string
  sortOrder: number
  runCount: number
  createdAt: Date
  updatedAt: Date
}

/**
 * The keysets behind the sortable workflow fields. `satisfies` makes the map
 * total over the contract enum, so a new sortable field cannot ship without an
 * ordering. Every key column is `NOT NULL` and each keyset ends in `id`, which
 * is what keeps a page boundary inside a run of equal values stable.
 *
 * `position` keeps its historical three-part ordering: workflows share a
 * `sortOrder` freely, and dropping `createdAt` from the tiebreak would reshuffle
 * every workspace's default list.
 */
const workflowId = textKey<WorkflowRow>(workflow.id, (row) => row.id)
const workflowCreatedAt = timestampKey<WorkflowRow>(workflow.createdAt, (row) => row.createdAt)

const WORKFLOW_SORTS = {
  position: [
    numberKey<WorkflowRow>(workflow.sortOrder, (row) => row.sortOrder),
    workflowCreatedAt,
    workflowId,
  ],
  name: [textKey<WorkflowRow>(workflow.name, (row) => row.name), workflowId],
  createdAt: [workflowCreatedAt, workflowId],
  updatedAt: [timestampKey<WorkflowRow>(workflow.updatedAt, (row) => row.updatedAt), workflowId],
  runCount: [numberKey<WorkflowRow>(workflow.runCount, (row) => row.runCount), workflowId],
} satisfies Record<V2WorkflowSortBy, readonly KeysetKey<WorkflowRow>[]>

export const GET = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateId().slice(0, 8)

  try {
    const rateLimit = await checkRateLimit(request, 'workflows')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

    const userId = rateLimit.userId!

    const gate = await v2ApiGateError(userId)
    if (gate) return gate

    const parsed = await parseRequest(
      v2ListWorkflowsContract,
      request,
      {},
      {
        validationErrorResponse: v2ValidationError,
      }
    )
    if (!parsed.success) return parsed.response

    const params = parsed.data.query

    const access = await resolveWorkspaceAccess(rateLimit, userId, params.workspaceId, 'read')
    if (access) return v2WorkspaceAccessError(access)

    const folderIndex = await loadActiveFolderPathIndex(params.workspaceId, 'workflow')
    const folderId =
      params.folderPath === undefined
        ? undefined
        : resolveFolderPathId(folderIndex, params.folderPath)
    if (params.folderPath !== undefined && folderId === undefined) {
      return v2Error('NOT_FOUND', 'Folder not found')
    }

    const sortKey = cursorSortKey(params.sortBy, params.sortOrder)
    const keys: readonly KeysetKey<WorkflowRow>[] = WORKFLOW_SORTS[params.sortBy]
    const decoded = decodeSortedCursor(params.cursor, sortKey)
    if (decoded.status === 'invalid') return v2CursorSortError()

    // `null` here is a cursor whose values don't fit this sort — a client error, not an empty page.
    const resumeAfter =
      decoded.status === 'ok' ? keysetAfter(keys, decoded.keys, params.sortOrder) : undefined
    if (resumeAfter === null) return v2CursorSortError()

    const conditions = [
      eq(workflow.workspaceId, params.workspaceId),
      isNull(workflow.archivedAt),
      params.folderPath === undefined
        ? undefined
        : folderId === null
          ? isNull(workflow.folderId)
          : folderId === undefined
            ? undefined
            : eq(workflow.folderId, folderId),
      params.deployedOnly ? eq(workflow.isDeployed, true) : undefined,
      searchFilter(workflow.name, params.search),
      resumeAfter,
    ]

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
      .where(and(...conditions))
      .orderBy(...listOrderBy(keysetColumns(keys), params.sortOrder))
      .limit(params.limit + 1)

    const hasMore = rows.length > params.limit
    const data = rows.slice(0, params.limit)

    const last = data.at(-1)
    const nextCursor =
      hasMore && last ? encodeSortedCursor(sortKey, encodeKeyset(keys, last)) : null

    const formatted: V2WorkflowListItem[] = data.map((w) => ({
      id: w.id,
      name: w.name,
      description: w.description,
      folderPath: folderPathForId(folderIndex, w.folderId),
      workspaceId: w.workspaceId ?? params.workspaceId,
      isDeployed: w.isDeployed,
      deployedAt: w.deployedAt?.toISOString() ?? null,
      runCount: w.runCount,
      lastRunAt: w.lastRunAt?.toISOString() ?? null,
      createdAt: w.createdAt.toISOString(),
      updatedAt: w.updatedAt.toISOString(),
    }))

    return v2CursorList(formatted, nextCursor, { rateLimit })
  } catch (error) {
    logger.error(`[${requestId}] Workflows fetch error`, {
      error: getErrorMessage(error, 'Unknown error'),
    })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})

/** POST /api/v2/workflows — Create an empty workflow in a workspace. */
export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateId().slice(0, 8)

  try {
    const rateLimit = await checkRateLimit(request, 'workflows')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

    const userId = rateLimit.userId!

    const gate = await v2ApiGateError(userId)
    if (gate) return gate

    const parsed = await parseRequest(
      v2CreateWorkflowContract,
      request,
      {},
      { validationErrorResponse: v2ValidationError }
    )
    if (!parsed.success) return parsed.response

    const { workspaceId, name, description, folderPath } = parsed.data.body

    const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'write')
    if (access) return v2WorkspaceAccessError(access)

    const resolution = await resolveFolderPathIdentity({
      workspaceId,
      resourceType: 'workflow',
      path: folderPath ?? '/',
    })
    if (!resolution.found) return v2Error('NOT_FOUND', 'Folder not found')

    await assertFolderMutable(resolution.folderId)
    const result = await performCreateWorkflow({
      userId,
      workspaceId,
      name,
      description,
      folderId: resolution.folderId,
      requestId,
    })

    if (!result.success || !result.workflow) {
      return v2ErrorForOrchestration(result.errorCode, result.error ?? 'Failed to create workflow')
    }

    const created = result.workflow
    const item: V2WorkflowListItem = {
      id: created.id,
      name: created.name,
      description: created.description ?? null,
      folderPath: folderPathForId(resolution.index, created.folderId),
      workspaceId: created.workspaceId,
      isDeployed: false,
      deployedAt: null,
      runCount: 0,
      lastRunAt: null,
      createdAt: created.createdAt.toISOString(),
      updatedAt: created.updatedAt.toISOString(),
    }

    return v2Data(item, { rateLimit, status: 201 })
  } catch (error) {
    if (error instanceof FolderLockedError) return v2Error('LOCKED', error.message)

    logger.error(`[${requestId}] Workflow create error`, {
      error: getErrorMessage(error, 'Unknown error'),
    })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})
