import { traceSpansSchema } from '@/lib/api/contracts/logs'
import {
  type V2LogListItem,
  v2ListLogsContract,
  v2LogStatusSchema,
} from '@/lib/api/contracts/v2/logs'
import {
  cursorRoute,
  cursorScopeKey,
  instantScopePart,
  parseUnorderedList,
  UNREADABLE_CURSOR_MESSAGE,
  unorderedScopePart,
} from '@/lib/api/cursor-binding'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { v2LogErrorPolicies } from '@/lib/logs/api/route-policies'
import { listPublicLogs } from '@/lib/logs/application/list-public-logs'
import { logOperations } from '@/lib/logs/application/operations'
import { decodePublicLogCursor } from '@/lib/logs/public-queries'
import { encodeScopedCursor, readScopedCursor } from '@/app/api/v2/lib/response'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * Every param that changes which logs, in which order, this list returns.
 *
 * `details`, `includeFinalOutput`, and `includeTraceSpans` are deliberately
 * absent: they decide how much of each row is rendered, not which rows are in
 * the sequence, so a caller may turn them on mid-walk.
 */
function logCursorFilters(query: {
  workspaceId: string
  workflowIds?: string
  triggers?: string
  level?: string
  startDate?: string
  endDate?: string
  runId?: string
  minDurationMs?: number
  maxDurationMs?: number
  minCost?: number
  maxCost?: number
  model?: string
  folderPaths?: string
  order?: string
}) {
  return cursorScopeKey(cursorRoute(v2ListLogsContract), {
    workspaceId: query.workspaceId,
    workflowIds: unorderedScopePart(query.workflowIds),
    triggers: unorderedScopePart(query.triggers),
    level: query.level,
    startDate: instantScopePart(query.startDate),
    endDate: instantScopePart(query.endDate),
    runId: query.runId,
    minDurationMs: query.minDurationMs,
    maxDurationMs: query.maxDurationMs,
    minCost: query.minCost,
    maxCost: query.maxCost,
    model: query.model,
    folderPaths: unorderedScopePart(query.folderPaths),
    order: query.order,
  })
}

export const GET = defineV2JsonRoute({
  contract: v2ListLogsContract,
  auth: v2ApiKeyAuth,
  operation: logOperations.list,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2LogErrorPolicies.default,
  mapInput: ({ query }) => {
    const inner = readScopedCursor(query.cursor, logCursorFilters(query))
    const decodedCursor = inner ? decodePublicLogCursor(inner, query.order ?? 'desc') : null
    if (inner && !decodedCursor) {
      throw new OrchestrationError('validation', UNREADABLE_CURSOR_MESSAGE)
    }
    return {
      workspaceId: query.workspaceId,
      filters: {
        workflowIds: parseUnorderedList(query.workflowIds),
        triggers: parseUnorderedList(query.triggers),
        level: query.level,
        startDate: query.startDate ? new Date(query.startDate) : undefined,
        endDate: query.endDate ? new Date(query.endDate) : undefined,
        executionId: query.runId,
        minDurationMs: query.minDurationMs,
        maxDurationMs: query.maxDurationMs,
        minCost: query.minCost,
        maxCost: query.maxCost,
        model: query.model,
        cursor: decodedCursor ?? undefined,
        order: query.order,
      },
      folderPaths: parseUnorderedList(query.folderPaths),
      limit: query.limit,
      includeFullDetails:
        query.details === 'full' || query.includeFinalOutput || query.includeTraceSpans,
      includeFinalOutput: query.includeFinalOutput,
      includeTraceSpans: query.includeTraceSpans,
    }
  },
  useCase: listPublicLogs,
  present: (
    { items, nextCursor, includeFullDetails, includeFinalOutput, includeTraceSpans },
    { query }
  ) => ({
    data: items.map(({ log, executionData }): V2LogListItem => {
      const item: V2LogListItem = {
        runId: log.executionId,
        workflowId: log.workflowId,
        deploymentVersionId: log.deploymentVersionId,
        status: v2LogStatusSchema.parse(log.status),
        level: log.level,
        trigger: log.trigger,
        startedAt: log.startedAt.toISOString(),
        endedAt: log.endedAt ? log.endedAt.toISOString() : null,
        totalDurationMs: log.totalDurationMs,
        cost: log.costTotal != null ? { total: Number(log.costTotal) } : null,
        files: (log.files as unknown[] | null) ?? null,
      }
      if (includeFullDetails) {
        item.workflow = {
          id: log.workflowId,
          name: log.workflowName || 'Deleted Workflow',
          description: log.workflowDescription,
          deleted: !log.workflowName || log.workflowArchivedAt !== null,
        }
      }
      if (executionData) {
        if (includeFinalOutput && executionData.finalOutput !== undefined) {
          item.finalOutput = executionData.finalOutput
        }
        if (includeTraceSpans) {
          item.traceSpans = traceSpansSchema.parse(executionData.traceSpans ?? [])
        }
      }
      return item
    }),
    nextCursor: nextCursor ? encodeScopedCursor(logCursorFilters(query), nextCursor) : null,
  }),
})
