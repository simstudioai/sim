import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import {
  type V2WorkflowRunListItem,
  v2ListWorkflowRunsContract,
  v2WorkflowRunListStatusValueSchema,
} from '@/lib/api/contracts/v2/workflows'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { listWorkflowExecutions } from '@/lib/workflows/executor/execution-queries'
import {
  cursorSortKey,
  decodeSortedCursor,
  encodeSortedCursor,
  v2CursorList,
  v2CursorSortError,
  v2Error,
  v2ValidationError,
} from '@/app/api/v2/lib/response'
import { resolveV2WorkflowAccess } from '@/app/api/v2/workflows/lib/access'

const logger = createLogger('V2WorkflowRunsAPI')

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** List the durable runs belonging to one workflow. */
export const GET = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const { id: workflowId } = await context.params
    const access = await resolveV2WorkflowAccess(request, workflowId, 'read')
    if (!access.ok) return access.response

    const parsed = await parseRequest(v2ListWorkflowRunsContract, request, context, {
      validationErrorResponse: v2ValidationError,
    })
    if (!parsed.success) return parsed.response

    const { status, trigger, startDate, endDate, limit, cursor, order } = parsed.data.query
    const sort = cursorSortKey('startedAt', order)
    const decodedCursor = decodeSortedCursor(cursor, sort)
    if (decodedCursor.status === 'invalid') return v2CursorSortError()
    const [cursorStartedAt, cursorRowId] = decodedCursor.status === 'ok' ? decodedCursor.keys : []
    const cursorDate = typeof cursorStartedAt === 'string' ? new Date(cursorStartedAt) : null
    if (
      decodedCursor.status === 'ok' &&
      (decodedCursor.keys.length !== 2 ||
        !cursorDate ||
        Number.isNaN(cursorDate.getTime()) ||
        typeof cursorRowId !== 'string')
    ) {
      return v2CursorSortError()
    }

    try {
      const result = await listWorkflowExecutions({
        workflowId,
        status,
        trigger,
        startDate: startDate ? new Date(startDate) : undefined,
        endDate: endDate ? new Date(endDate) : undefined,
        limit,
        cursor:
          decodedCursor.status === 'ok' && cursorDate && typeof cursorRowId === 'string'
            ? { startedAt: cursorDate, rowId: cursorRowId }
            : undefined,
        order,
      })

      const data: V2WorkflowRunListItem[] = result.data.map((row) => ({
        runId: row.executionId,
        workflowId: row.workflowId ?? workflowId,
        status: v2WorkflowRunListStatusValueSchema.parse(row.status),
        trigger: row.trigger,
        startedAt: row.startedAt.toISOString(),
        endedAt: row.endedAt?.toISOString() ?? null,
        durationMs: row.durationMs,
        cost: row.costTotal != null ? { total: Number(row.costTotal) } : null,
      }))

      const nextCursor = result.nextCursor
        ? encodeSortedCursor(sort, [
            result.nextCursor.startedAt.toISOString(),
            result.nextCursor.rowId,
          ])
        : null

      return v2CursorList(data, nextCursor)
    } catch (error) {
      logger.error('Failed to list workflow runs', {
        workflowId,
        error: getErrorMessage(error, 'Unknown error'),
      })
      return v2Error('INTERNAL_ERROR', 'Internal server error')
    }
  }
)
