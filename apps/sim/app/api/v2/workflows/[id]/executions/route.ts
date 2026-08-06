import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import {
  type V2WorkflowExecutionListItem,
  v2ListWorkflowExecutionsContract,
  v2WorkflowExecutionStatusValueSchema,
} from '@/lib/api/contracts/v2/workflows'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { listWorkflowExecutions } from '@/lib/workflows/executor/execution-queries'
import {
  decodeCursor,
  encodeCursor,
  v2CursorList,
  v2Error,
  v2ValidationError,
} from '@/app/api/v2/lib/response'
import { resolveV2WorkflowAccess } from '@/app/api/v2/workflows/lib/access'

const logger = createLogger('V2WorkflowExecutionsAPI')

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface EncodedWorkflowExecutionCursor {
  startedAt: string
  rowId: string
}

/** List the durable executions belonging to one workflow. */
export const GET = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const { id: workflowId } = await context.params
    const access = await resolveV2WorkflowAccess(request, workflowId, 'read')
    if (!access.ok) return access.response

    const parsed = await parseRequest(v2ListWorkflowExecutionsContract, request, context, {
      validationErrorResponse: v2ValidationError,
    })
    if (!parsed.success) return parsed.response

    const { status, trigger, startDate, endDate, limit, cursor, order } = parsed.data.query
    const decodedCursor = cursor ? decodeCursor<EncodedWorkflowExecutionCursor>(cursor) : null
    const cursorDate = decodedCursor ? new Date(decodedCursor.startedAt) : null
    if (
      cursor &&
      (!decodedCursor || !decodedCursor.rowId || !cursorDate || Number.isNaN(cursorDate.getTime()))
    ) {
      return v2Error('BAD_REQUEST', 'Invalid cursor')
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
          decodedCursor && cursorDate
            ? { startedAt: cursorDate, rowId: decodedCursor.rowId }
            : undefined,
        order,
      })

      const data: V2WorkflowExecutionListItem[] = result.data.map((row) => ({
        executionId: row.executionId,
        workflowId: row.workflowId ?? workflowId,
        status: v2WorkflowExecutionStatusValueSchema.parse(row.status),
        trigger: row.trigger,
        startedAt: row.startedAt.toISOString(),
        endedAt: row.endedAt?.toISOString() ?? null,
        durationMs: row.durationMs,
        cost: row.costTotal != null ? { total: Number(row.costTotal) } : null,
      }))

      const nextCursor = result.nextCursor
        ? encodeCursor({
            startedAt: result.nextCursor.startedAt.toISOString(),
            rowId: result.nextCursor.rowId,
          })
        : null

      return v2CursorList(data, nextCursor)
    } catch (error) {
      logger.error('Failed to list workflow executions', {
        workflowId,
        error: getErrorMessage(error, 'Unknown error'),
      })
      return v2Error('INTERNAL_ERROR', 'Internal server error')
    }
  }
)
