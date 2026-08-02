import { db } from '@sim/db'
import { workflow } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, eq, isNull } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import {
  type V2WorkflowListItem,
  type V2WorkflowSortBy,
  v2ListWorkflowsContract,
} from '@/lib/api/contracts/v2/workflows'
import {
  cursorDate,
  type KeysetSort,
  keysetAfter,
  listOrderBy,
  searchFilter,
} from '@/lib/api/list-query'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { checkRateLimit, resolveWorkspaceAccess } from '@/app/api/v1/middleware'
import { v2ApiGateError } from '@/app/api/v2/lib/gate'
import {
  cursorSortKey,
  decodeSortedCursor,
  encodeSortedCursor,
  v2CursorList,
  v2CursorSortError,
  v2Error,
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
const WORKFLOW_SORTS = {
  position: {
    keys: [workflow.sortOrder, workflow.createdAt, workflow.id],
    encode: (row) => [row.sortOrder, cursorDate.encode(row.createdAt), row.id],
    decode: ([sortOrder, createdAt, id]) => [
      Number(sortOrder),
      cursorDate.decode(createdAt),
      String(id),
    ],
  },
  name: {
    keys: [workflow.name, workflow.id],
    encode: (row) => [row.name, row.id],
    decode: ([name, id]) => [String(name), String(id)],
  },
  createdAt: {
    keys: [workflow.createdAt, workflow.id],
    encode: (row) => [cursorDate.encode(row.createdAt), row.id],
    decode: ([createdAt, id]) => [cursorDate.decode(createdAt), String(id)],
  },
  updatedAt: {
    keys: [workflow.updatedAt, workflow.id],
    encode: (row) => [cursorDate.encode(row.updatedAt), row.id],
    decode: ([updatedAt, id]) => [cursorDate.decode(updatedAt), String(id)],
  },
  runCount: {
    keys: [workflow.runCount, workflow.id],
    encode: (row) => [row.runCount, row.id],
    decode: ([runCount, id]) => [Number(runCount), String(id)],
  },
} satisfies Record<V2WorkflowSortBy, KeysetSort<WorkflowRow>>

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

    const sortKey = cursorSortKey(params.sortBy, params.sortOrder)
    const sort: KeysetSort<WorkflowRow> = WORKFLOW_SORTS[params.sortBy]
    const decoded = decodeSortedCursor(params.cursor, sortKey, sort.keys.length)
    if (decoded.status === 'invalid') return v2CursorSortError()

    const conditions = [
      eq(workflow.workspaceId, params.workspaceId),
      isNull(workflow.archivedAt),
      params.folderId ? eq(workflow.folderId, params.folderId) : undefined,
      params.deployedOnly ? eq(workflow.isDeployed, true) : undefined,
      searchFilter(workflow.name, params.search),
      decoded.status === 'ok'
        ? keysetAfter(sort.keys, sort.decode(decoded.keys), params.sortOrder)
        : undefined,
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
      .orderBy(...listOrderBy(sort.keys, params.sortOrder))
      .limit(params.limit + 1)

    const hasMore = rows.length > params.limit
    const data = rows.slice(0, params.limit)

    const last = data.at(-1)
    const nextCursor = hasMore && last ? encodeSortedCursor(sortKey, sort.encode(last)) : null

    const formatted: V2WorkflowListItem[] = data.map((w) => ({
      id: w.id,
      name: w.name,
      description: w.description,
      folderId: w.folderId,
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
