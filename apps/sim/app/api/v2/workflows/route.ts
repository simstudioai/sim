import { db } from '@sim/db'
import { workflow } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, asc, eq, gt, isNull, or } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { type V2WorkflowListItem, v2ListWorkflowsContract } from '@/lib/api/contracts/v2/workflows'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { checkRateLimit, resolveWorkspaceAccess } from '@/app/api/v1/middleware'
import {
  decodeCursor,
  encodeCursor,
  v2CursorList,
  v2Error,
  v2RateLimitError,
  v2ValidationError,
  v2WorkspaceAccessError,
} from '@/app/api/v2/lib/response'

const logger = createLogger('V2WorkflowsAPI')

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** Keyset cursor for the `(sortOrder, createdAt, id)` ordering. */
interface WorkflowListCursor {
  sortOrder: number
  createdAt: string
  id: string
}

export const GET = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateId().slice(0, 8)

  try {
    const rateLimit = await checkRateLimit(request, 'workflows')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

    const userId = rateLimit.userId!
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

    const conditions = [eq(workflow.workspaceId, params.workspaceId), isNull(workflow.archivedAt)]

    if (params.folderId) {
      conditions.push(eq(workflow.folderId, params.folderId))
    }

    if (params.deployedOnly) {
      conditions.push(eq(workflow.isDeployed, true))
    }

    if (params.cursor) {
      const cursorData = decodeCursor<WorkflowListCursor>(params.cursor)
      if (cursorData) {
        const cursorCondition = or(
          gt(workflow.sortOrder, cursorData.sortOrder),
          and(
            eq(workflow.sortOrder, cursorData.sortOrder),
            gt(workflow.createdAt, new Date(cursorData.createdAt))
          ),
          and(
            eq(workflow.sortOrder, cursorData.sortOrder),
            eq(workflow.createdAt, new Date(cursorData.createdAt)),
            gt(workflow.id, cursorData.id)
          )
        )
        if (cursorCondition) {
          conditions.push(cursorCondition)
        }
      }
    }

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
      .orderBy(asc(workflow.sortOrder), asc(workflow.createdAt), asc(workflow.id))
      .limit(params.limit + 1)

    const hasMore = rows.length > params.limit
    const data = rows.slice(0, params.limit)

    let nextCursor: string | null = null
    if (hasMore && data.length > 0) {
      const last = data[data.length - 1]
      nextCursor = encodeCursor({
        sortOrder: last.sortOrder,
        createdAt: last.createdAt.toISOString(),
        id: last.id,
      })
    }

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
