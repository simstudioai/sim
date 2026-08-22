import { createLogger } from '@sim/logger'
import { z } from 'zod'
import { QueryLogs } from '@/lib/copilot/generated/tool-catalog-v1'
import type { BaseServerTool, ServerToolContext } from '@/lib/copilot/tools/server/base-tool'
import { requireCopilotWorkspace } from '@/lib/copilot/tools/server/workspace-scope'
import {
  collectLargeValueExecutionIds,
  collectLargeValueKeys,
} from '@/lib/execution/payloads/large-execution-value'
import { fetchLogDetail } from '@/lib/logs/fetch-log-detail'
import { type ListLogsParams, listLogs } from '@/lib/logs/list-logs'
import { grepSpans, type LogViewContext, toFull, toOverview, toTrace } from '@/lib/logs/log-views'
import { statsLogs } from '@/lib/logs/stats-logs'
import type { TraceSpan } from '@/lib/logs/types'

const logger = createLogger('QueryLogsServerTool')

/**
 * Max serialized size for a `full` view result before falling back to the
 * compact overview. Keeps a single tool result inline-able.
 */
const MAX_FULL_RESULT_BYTES = 512 * 1024

const comparisonOperator = z.enum(['=', '>', '<', '>=', '<=', '!='])

/** Display-only label rendered in the UI tool row; never used server-side. */
const displayTitle = z.string().optional()

const listArgsSchema = z.object({
  view: z.literal('list'),
  title: displayTitle,
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

const statsArgsSchema = z.object({
  view: z.literal('stats'),
  title: displayTitle,
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
  bucket: z.enum(['day', 'hour']).optional(),
  timezone: z.string().optional(),
})

const traceArgsSchema = z.object({
  view: z.literal('trace'),
  title: displayTitle,
  workspaceId: z.string().optional(),
  executionId: z.string(),
})

const overviewArgsSchema = z.object({
  view: z.literal('overview'),
  title: displayTitle,
  workspaceId: z.string().optional(),
  executionId: z.string(),
  pattern: z.string().optional(),
})

const fullArgsSchema = z.object({
  view: z.literal('full'),
  title: displayTitle,
  workspaceId: z.string().optional(),
  executionId: z.string(),
  blockId: z.string().optional(),
  blockIds: z.array(z.string()).optional(),
  blockName: z.string().optional(),
  fields: z.array(z.string()).optional(),
  pattern: z.string().optional(),
})

const queryLogsViewsSchema = z.discriminatedUnion('view', [
  listArgsSchema,
  statsArgsSchema,
  traceArgsSchema,
  overviewArgsSchema,
  fullArgsSchema,
])

/**
 * `view` defaults to the compact disclosure level: `trace` when an
 * `executionId` is supplied, `list` otherwise.
 */
const queryLogsArgsSchema = z.preprocess((value) => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>
    if (record.view === undefined) {
      return { ...record, view: record.executionId ? 'trace' : 'list' }
    }
  }
  return value
}, queryLogsViewsSchema)

type QueryLogsArgs = z.infer<typeof queryLogsArgsSchema>

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
 *   set (reuses `listLogs`); always carries `total` for the filtered set.
 * - `view: "stats"` — server-side aggregation (counts by status, per workflow,
 *   optionally calendar-bucketed) under the same filters; answers quantitative
 *   questions in one call instead of a paginate-and-count walk.
 * - `view: "trace"` — one execution's condensed per-block digest: names,
 *   statuses, execution counts (loop iterations collapse), block ids to drill
 *   into.
 * - `view: "overview"` — a single execution's trace-span tree (timing + cost,
 *   no input/output).
 * - `view: "full"` — a single execution's trace spans with materialized
 *   input/output, scoped via `blockIds` (from the trace digest) / `blockName`.
 * - `pattern` (with `overview`/`full`) — grep that execution's trace spans,
 *   streaming large values chunk-by-chunk.
 */
export const queryLogsServerTool: BaseServerTool<QueryLogsArgs, unknown> = {
  name: QueryLogs.id,
  inputSchema: queryLogsArgsSchema,
  outputSchema: z.unknown(),
  async execute(rawArgs: QueryLogsArgs, context?: ServerToolContext): Promise<unknown> {
    // Re-parse so the compact-view default applies even when a caller bypasses
    // the router's schema validation; idempotent on already-parsed args.
    const args = queryLogsArgsSchema.parse(rawArgs) as QueryLogsArgs
    if (!context?.userId) {
      throw new Error('Unauthorized access')
    }
    const userId = context.userId
    const workspaceId = requireCopilotWorkspace(context, args.workspaceId)

    if (args.view === 'list') {
      const { view: _view, title: _title, ...rest } = args
      const params = { ...rest, workspaceId, includeTotal: true } as ListLogsParams
      logger.info('query_logs list', { workspaceId, sortBy: params.sortBy })
      const { data, nextCursor, total } = await listLogs(params, userId)
      // Cursor and total lead the payload so a truncated render still shows them.
      return { total, nextCursor, data }
    }

    if (args.view === 'stats') {
      const { view: _view, title: _title, ...rest } = args
      logger.info('query_logs stats', { workspaceId, bucket: rest.bucket })
      return statsLogs({ ...rest, workspaceId }, userId)
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

    if (args.view === 'trace') {
      return {
        executionId: detail.executionId,
        workflowId: detail.workflowId,
        status: detail.status,
        trigger: detail.trigger,
        durationMs: execData?.totalDuration ?? null,
        blocks: toTrace(traceSpans),
      }
    }

    const viewCtx = buildLogViewContext(detail, workspaceId, userId)

    if (args.pattern) {
      logger.info('query_logs grep', { workspaceId, executionId: args.executionId })
      const { matches, truncated, patternNotice } = await grepSpans(
        traceSpans,
        args.pattern,
        viewCtx
      )
      return {
        executionId: detail.executionId,
        workflowId: detail.workflowId,
        status: detail.status,
        pattern: args.pattern,
        ...(patternNotice ? { patternNotice } : {}),
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
    const spans = await toFull(
      traceSpans,
      viewCtx,
      {
        blockId: args.blockId,
        blockIds: args.blockIds,
        blockName: args.blockName,
      },
      args.fields
    )
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
        note: 'Full result too large; returning the compact overview. Scope with blockIds/blockName (ids from view "trace"), or use pattern to grep.',
        spans: toOverview(traceSpans),
      }
    }

    return result
  },
}
