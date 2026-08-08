import { traceSpansSchema } from '@/lib/api/contracts/logs'
import {
  type V2LogListItem,
  v2ListLogsContract,
  v2LogStatusSchema,
} from '@/lib/api/contracts/v2/logs'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { v2LogErrorPolicies } from '@/lib/logs/api/route-policies'
import { listPublicLogs } from '@/lib/logs/application/list-public-logs'
import { logOperations } from '@/lib/logs/application/operations'
import { decodePublicLogCursor } from '@/lib/logs/public-queries'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const GET = defineV2JsonRoute({
  contract: v2ListLogsContract,
  auth: v2ApiKeyAuth,
  operation: logOperations.list,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2LogErrorPolicies.default,
  mapInput: ({ query }) => {
    const decodedCursor = query.cursor
      ? decodePublicLogCursor(query.cursor, query.order ?? 'desc')
      : null
    if (query.cursor && !decodedCursor) {
      throw new OrchestrationError('validation', 'Invalid cursor')
    }
    return {
      workspaceId: query.workspaceId,
      filters: {
        workflowIds: query.workflowIds?.split(',').filter(Boolean),
        triggers: query.triggers?.split(',').filter(Boolean),
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
      folderPaths: query.folderPaths?.split(',').filter(Boolean),
      limit: query.limit,
      includeFullDetails:
        query.details === 'full' || query.includeFinalOutput || query.includeTraceSpans,
      includeFinalOutput: query.includeFinalOutput,
      includeTraceSpans: query.includeTraceSpans,
    }
  },
  useCase: listPublicLogs,
  present: ({ items, nextCursor, includeFullDetails, includeFinalOutput, includeTraceSpans }) => ({
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
    nextCursor,
  }),
})
