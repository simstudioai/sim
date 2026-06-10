import { createLogger } from '@sim/logger'
import { z } from 'zod'
import { QueryLogs } from '@/lib/copilot/generated/tool-catalog-v1'
import type { BaseServerTool, ServerToolContext } from '@/lib/copilot/tools/server/base-tool'
import {
  collectLargeValueExecutionIds,
  collectLargeValueKeys,
} from '@/lib/execution/payloads/large-execution-value'
import { fetchLogDetail } from '@/lib/logs/fetch-log-detail'
import { type ListLogsParams, listLogs } from '@/lib/logs/list-logs'
import { grepSpans, type LogViewContext, toFull, toOverview } from '@/lib/logs/log-views'
import type { TraceSpan } from '@/lib/logs/types'

const logger = createLogger('QueryLogsServerTool')

/**
 * Max serialized size for a `full` view result before falling back to the
 * compact overview. Keeps a single tool result inline-able.
 */
const MAX_FULL_RESULT_BYTES = 512 * 1024

const comparisonOperator = z.enum(['=', '>', '<', '>=', '<=', '!='])

const listArgsSchema = z.object({
  view: z.literal('list'),
  workspaceId: z.string().optional(),
  level: z.string().optional(),
  workflowIds: z.string().optional(),
  folderIds: z.string().optional(),
  triggers: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  search: z.string().optional(),
  workflowName: z.string().optional(),
  folderName: z.string().optional(),
  executionId: z.string().optional(),
  costOperator: comparisonOperator.optional(),
  costValue: z.coerce.number().optional(),
  durationOperator: comparisonOperator.optional(),
  durationValue: z.coerce.number().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(100),
  sortBy: z.enum(['date', 'duration', 'cost', 'status']).optional().default('date'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
})

const overviewArgsSchema = z.object({
  view: z.literal('overview'),
  workspaceId: z.string().optional(),
  executionId: z.string(),
  pattern: z.string().optional(),
})

const fullArgsSchema = z.object({
  view: z.literal('full'),
  workspaceId: z.string().optional(),
  executionId: z.string(),
  blockId: z.string().optional(),
  blockName: z.string().optional(),
  pattern: z.string().optional(),
})

const queryLogsArgsSchema = z.discriminatedUnion('view', [
  listArgsSchema,
  overviewArgsSchema,
  fullArgsSchema,
])

type QueryLogsArgs = z.infer<typeof queryLogsArgsSchema>

function resolveWorkspaceId(args: QueryLogsArgs, context?: ServerToolContext): string {
  const workspaceId = args.workspaceId ?? context?.workspaceId
  if (!workspaceId) {
    throw new Error('workspaceId is required')
  }
  return workspaceId
}

function buildLogViewContext(
  detail: {
    workflowId: string | null
    executionId: string
    executionData?: unknown
  },
  workspaceId: string,
  userId: string
): LogViewContext {
  return {
    workspaceId,
    workflowId: detail.workflowId ?? undefined,
    executionId: detail.executionId,
    userId,
    largeValueExecutionIds: collectLargeValueExecutionIds(detail.executionData),
    largeValueKeys: collectLargeValueKeys(detail.executionData),
    allowLargeValueWorkflowScope: true,
  }
}

/**
 * Consolidated execution/log read tool.
 *
 * - `view: "list"` — paginated execution summaries with the full Logs-UI filter
 *   set (reuses `listLogs`).
 * - `view: "overview"` — a single execution's trace-span tree (timing + cost,
 *   no input/output).
 * - `view: "full"` — a single execution's trace spans with materialized
 *   input/output, optionally scoped to one block via `blockId`/`blockName`.
 * - `pattern` (with `overview`/`full`) — grep that execution's trace spans,
 *   streaming large values chunk-by-chunk.
 */
export const queryLogsServerTool: BaseServerTool<QueryLogsArgs, unknown> = {
  name: QueryLogs.id,
  inputSchema: queryLogsArgsSchema,
  outputSchema: z.unknown(),
  async execute(args: QueryLogsArgs, context?: ServerToolContext): Promise<unknown> {
    if (!context?.userId) {
      throw new Error('Unauthorized access')
    }
    const userId = context.userId
    const workspaceId = resolveWorkspaceId(args, context)

    if (args.view === 'list') {
      const { view: _view, ...rest } = args
      const params = { ...rest, workspaceId } as ListLogsParams
      logger.info('query_logs list', { workspaceId, sortBy: params.sortBy })
      return listLogs(params, userId)
    }

    // overview / full / grep — single execution by id
    const detail = await fetchLogDetail({
      userId,
      workspaceId,
      lookupColumn: 'executionId',
      lookupValue: args.executionId,
    })
    if (!detail) {
      return { ok: false, error: `Execution not found: ${args.executionId}` }
    }

    const execData = detail.executionData as
      | { traceSpans?: TraceSpan[]; totalDuration?: number | null }
      | undefined
    const traceSpans = (execData?.traceSpans ?? []) as TraceSpan[]
    const viewCtx = buildLogViewContext(detail, workspaceId, userId)

    if (args.pattern) {
      logger.info('query_logs grep', { workspaceId, executionId: args.executionId })
      const { matches, truncated } = await grepSpans(traceSpans, args.pattern, viewCtx)
      return {
        executionId: detail.executionId,
        workflowId: detail.workflowId,
        status: detail.status,
        pattern: args.pattern,
        matches,
        truncated,
      }
    }

    if (args.view === 'overview') {
      return {
        executionId: detail.executionId,
        workflowId: detail.workflowId,
        status: detail.status,
        trigger: detail.trigger,
        durationMs: execData?.totalDuration ?? null,
        cost: detail.cost ?? null,
        spans: toOverview(traceSpans),
      }
    }

    // full
    const spans = await toFull(traceSpans, viewCtx, {
      blockId: args.blockId,
      blockName: args.blockName,
    })
    const result = {
      executionId: detail.executionId,
      workflowId: detail.workflowId,
      status: detail.status,
      trigger: detail.trigger,
      cost: detail.cost ?? null,
      spans,
      truncated: false,
    }

    if (JSON.stringify(result).length > MAX_FULL_RESULT_BYTES) {
      return {
        executionId: detail.executionId,
        workflowId: detail.workflowId,
        status: detail.status,
        truncated: true,
        note: 'Full result too large; returning the compact overview. Scope with blockId/blockName, or use pattern to grep.',
        spans: toOverview(traceSpans),
      }
    }

    return result
  },
}
