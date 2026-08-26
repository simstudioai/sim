import {
  type V2WorkflowRunListItem,
  v2ListWorkflowRunsContract,
  v2WorkflowRunListStatusValueSchema,
} from '@/lib/api/contracts/v2/workflows'
import {
  cursorRoute,
  cursorScopeKey,
  instantScopePart,
  UNREADABLE_CURSOR_MESSAGE,
} from '@/lib/api/cursor-binding'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { v2WorkflowErrorPolicies } from '@/lib/workflows/api'
import { listWorkflowRuns } from '@/lib/workflows/application/list-workflow-runs'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { readSortedCursor, writeSortedCursor } from '@/app/api/v2/lib/response'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** Every param that changes which runs, in which order, this list returns. */
function runCursorFilters(
  workflowId: string,
  query: { status?: string; trigger?: string; startDate?: string; endDate?: string }
) {
  return cursorScopeKey(cursorRoute(v2ListWorkflowRunsContract, { workflowId }), {
    status: query.status,
    trigger: query.trigger,
    startDate: instantScopePart(query.startDate),
    endDate: instantScopePart(query.endDate),
  })
}

/** List the durable runs belonging to one workflow. */
export const GET = defineV2JsonRoute({
  contract: v2ListWorkflowRunsContract,
  auth: v2ApiKeyAuth,
  operation: workflowOperations.listRuns,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2WorkflowErrorPolicies.concealWorkflowAuthorization,
  mapInput: ({ params, query }) => {
    const { status, trigger, startDate, endDate, limit, cursor, order } = query
    const cursorKeys = readSortedCursor(
      cursor,
      'startedAt',
      order,
      runCursorFilters(params.workflowId, query)
    )
    const [cursorStartedAt, cursorRowId] = cursorKeys ?? []
    const cursorDate = typeof cursorStartedAt === 'string' ? new Date(cursorStartedAt) : null
    if (
      cursorKeys &&
      (cursorKeys.length !== 2 ||
        !cursorDate ||
        Number.isNaN(cursorDate.getTime()) ||
        typeof cursorRowId !== 'string')
    ) {
      throw new OrchestrationError('validation', UNREADABLE_CURSOR_MESSAGE)
    }

    return {
      workflowId: params.workflowId,
      status,
      trigger,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      limit,
      cursor:
        cursorKeys && cursorDate && typeof cursorRowId === 'string'
          ? { startedAt: cursorDate, rowId: cursorRowId }
          : undefined,
      order,
    }
  },
  useCase: listWorkflowRuns,
  present: (result, { params, query }) => {
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
    const nextCursor = writeSortedCursor(
      result.nextCursor
        ? [result.nextCursor.startedAt.toISOString(), result.nextCursor.rowId]
        : null,
      'startedAt',
      result.order,
      runCursorFilters(params.workflowId, query)
    )
    return { data, nextCursor }
  },
})
