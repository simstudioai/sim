import {
  type V2WorkflowRunListItem,
  v2ListWorkflowRunsContract,
  v2WorkflowRunListStatusValueSchema,
} from '@/lib/api/contracts/v2/workflows'
import { INVALID_CURSOR_MESSAGE } from '@/lib/api/list-query'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { v2WorkflowErrorPolicies } from '@/lib/workflows/api'
import { listWorkflowRuns } from '@/lib/workflows/application/list-workflow-runs'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { cursorSortKey, decodeSortedCursor, encodeSortedCursor } from '@/app/api/v2/lib/response'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** List the durable runs belonging to one workflow. */
export const GET = defineV2JsonRoute({
  contract: v2ListWorkflowRunsContract,
  auth: v2ApiKeyAuth,
  operation: workflowOperations.listRuns,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2WorkflowErrorPolicies.concealWorkflowAuthorization,
  mapInput: ({ params, query }) => {
    const { status, trigger, startDate, endDate, limit, cursor, order } = query
    const sort = cursorSortKey('startedAt', order)
    const decodedCursor = decodeSortedCursor(cursor, sort)
    if (decodedCursor.status === 'invalid') {
      throw new OrchestrationError('validation', INVALID_CURSOR_MESSAGE)
    }
    const [cursorStartedAt, cursorRowId] = decodedCursor.status === 'ok' ? decodedCursor.keys : []
    const cursorDate = typeof cursorStartedAt === 'string' ? new Date(cursorStartedAt) : null
    if (
      decodedCursor.status === 'ok' &&
      (decodedCursor.keys.length !== 2 ||
        !cursorDate ||
        Number.isNaN(cursorDate.getTime()) ||
        typeof cursorRowId !== 'string')
    ) {
      throw new OrchestrationError('validation', INVALID_CURSOR_MESSAGE)
    }

    return {
      workflowId: params.id,
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
    }
  },
  useCase: listWorkflowRuns,
  present: (result) => {
    const data: V2WorkflowRunListItem[] = result.data.map((row) => ({
      runId: row.executionId,
      workflowId: row.workflowId ?? result.workflowId,
      status: v2WorkflowRunListStatusValueSchema.parse(row.status),
      trigger: row.trigger,
      startedAt: row.startedAt.toISOString(),
      endedAt: row.endedAt?.toISOString() ?? null,
      durationMs: row.durationMs,
      cost: row.costTotal != null ? { total: Number(row.costTotal) } : null,
    }))
    const sort = cursorSortKey('startedAt', result.order)
    const nextCursor = result.nextCursor
      ? encodeSortedCursor(sort, [
          result.nextCursor.startedAt.toISOString(),
          result.nextCursor.rowId,
        ])
      : null
    return { data, nextCursor }
  },
})
