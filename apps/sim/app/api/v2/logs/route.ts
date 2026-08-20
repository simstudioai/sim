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
import { jobCostTotal } from '@/lib/logs/fetch-log-detail'
import { LOG_FOLDER_SCOPE_VERSION } from '@/lib/logs/folder-scope'
import { decodePublicLogCursor } from '@/lib/logs/public-queries'
import { isPersistedWorkflowExecutionStatus } from '@/lib/logs/types'
import { encodeScopedCursor, readScopedCursor } from '@/app/api/v2/lib/response'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * Every param that changes which logs, in which order, this list returns.
 *
 * `details`, `includeFinalOutput`, and `includeTraceSpans` are deliberately
 * absent: they decide how much of each row is rendered, not which rows are in
 * the sequence, so a caller may turn them on mid-walk. `includeJobRuns` is NOT
 * one of those — it decides whether the job-run branch is in the sequence at
 * all, so it is bound.
 *
 * `folderScopeVersion` is stamped only when a folder filter is active, and it is
 * deliberately not a contract param, so it never appears in `CURSOR_BINDINGS` —
 * that sweep checks declarations against what the contract accepts, and a
 * route-side constant is invisible to it. It exists because a folder path now
 * selects its whole subtree: the path strings a caller sends did not change, so
 * without a version bump a token minted under the old rule would decode cleanly
 * and resume inside a larger sequence, silently skipping rows. Do not "fix" its
 * absence from the sweep by declaring it.
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
  status?: string
  workflowName?: string
  includeJobRuns?: boolean
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
    folderScopeVersion: query.folderPaths ? LOG_FOLDER_SCOPE_VERSION : undefined,
    order: query.order,
    status: unorderedScopePart(query.status),
    workflowName: query.workflowName,
    // Stamped only when it is on. `includeJobRuns` carries `.default(false)`, so
    // it is always present on the parsed query; binding it unconditionally would
    // put a constant in every fingerprint and reject every cursor minted before
    // the field existed — including on unfiltered walks, which is precisely what
    // `folderScopeVersion` above is careful not to do.
    includeJobRuns: query.includeJobRuns || undefined,
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
        statuses: parseUnorderedList(query.status)?.filter(isPersistedWorkflowExecutionStatus),
        workflowName: query.workflowName,
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
      includeJobRuns: query.includeJobRuns,
    }
  },
  useCase: listPublicLogs,
  present: (
    { items, nextCursor, includeFullDetails, includeFinalOutput, includeTraceSpans },
    { query }
  ) => ({
    data: items.map(({ log, executionData }): V2LogListItem => {
      if (log.kind === 'job') {
        /**
         * A job run's status is derived rather than passed through.
         *
         * `job_execution_logs.status` is an unconstrained text column written by
         * the job runtime, and this field is `.parse`d on the way out, so
         * publishing it verbatim would make one unrecognized value a 500 for the
         * whole page. Level and completion are the two facts this surface owns,
         * and they answer the question the field is for.
         */
        return {
          kind: 'job',
          runId: log.executionId,
          workflowId: null,
          deploymentVersionId: null,
          status: log.level === 'error' ? 'failed' : log.endedAt ? 'completed' : 'running',
          level: log.level,
          trigger: log.trigger,
          startedAt: log.startedAt.toISOString(),
          endedAt: log.endedAt ? log.endedAt.toISOString() : null,
          totalDurationMs: log.totalDurationMs,
          cost: jobCostTotal(log.cost),
          files: null,
        }
      }

      const item: V2LogListItem = {
        kind: 'workflow',
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
