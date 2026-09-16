import { z } from 'zod'
import { userFileSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'

const comparisonOperatorSchema = z.enum(['=', '>', '<', '>=', '<=', '!='])

export const logIdParamsSchema = z.object({
  id: z.string().min(1),
})

export const executionIdParamsSchema = z.object({
  executionId: z.string().min(1),
})

const logFilterQuerySchema = z.object({
  workspaceId: z.string(),
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
  costOperator: comparisonOperatorSchema.optional(),
  costValue: z.coerce.number().optional(),
  durationOperator: comparisonOperatorSchema.optional(),
  durationValue: z.coerce.number().optional(),
})

export const logSortBySchema = z.enum(['date', 'duration', 'cost', 'status']).default('date')
export const logSortOrderSchema = z.enum(['asc', 'desc']).default('desc')

export const listLogsQuerySchema = logFilterQuerySchema.extend({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(100),
  sortBy: logSortBySchema,
  sortOrder: logSortOrderSchema,
  /** Also run a COUNT(*) under the same filters and return it as `total`. */
  includeTotal: z.coerce.boolean().optional(),
})

export const logDetailQuerySchema = z.object({
  workspaceId: z.string().min(1),
})

/**
 * Largest number of time buckets the dashboard stats read will build.
 *
 * The bound is load-bearing, not cosmetic. `segmentCount` reaches
 * `buildDashboardStats` as the length of two densely materialized arrays — one
 * per workflow, one for the workspace aggregate — so an unbounded value
 * allocates without limit: `1e9` is a genuine 500. The lower bound is the
 * quieter half — `0` does not throw, it makes `segmentMs` `Infinity` and every
 * segment array empty, which serializes as `null` and hands the dashboard a
 * shaped response with nothing in it. Both were reachable from the query
 * string.
 */
export const MAX_STATS_SEGMENT_COUNT = 500

/**
 * Largest number of per-workflow series the dashboard stats read will return.
 *
 * `workflows` carries one entry per workflow that ran in the window, each with
 * `segmentCount` segments, so the response grows with the workspace rather than
 * with anything the caller asked for. Entries past the cap are dropped from
 * `workflows` only — the workspace aggregates are computed from every row first,
 * so the totals stay exact — and the truncation is reported rather than silent.
 */
export const MAX_STATS_WORKFLOWS = 200

export const statsQueryParamsSchema = logFilterQuerySchema.extend({
  segmentCount: z.coerce
    .number()
    .int('segmentCount must be a whole number')
    .min(1, 'segmentCount must be at least 1')
    .max(MAX_STATS_SEGMENT_COUNT, `segmentCount cannot exceed ${MAX_STATS_SEGMENT_COUNT}`)
    .optional()
    .default(72),
})

const workflowSummarySchema = z
  .object({
    id: z.string(),
    name: z.string().nullable(),
    description: z.string().nullable(),
    folderId: z.string().nullable(),
    userId: z.string().nullable(),
    workspaceId: z.string().nullable(),
    createdAt: z.string().nullable(),
    updatedAt: z.string().nullable(),
  })
  .partial()

const tokenBreakdownSchema = z
  .object({
    total: z.number().optional(),
    input: z.number().optional(),
    output: z.number().optional(),
    prompt: z.number().optional(),
    completion: z.number().optional(),
  })
  .partial()

const modelCostSchema = z
  .object({
    input: z.number().optional(),
    output: z.number().optional(),
    total: z.number().optional(),
    tokens: tokenBreakdownSchema.optional(),
  })
  .partial()

const costSummarySchema = z
  .object({
    total: z.number().optional(),
    input: z.number().optional(),
    output: z.number().optional(),
    tokens: tokenBreakdownSchema.optional(),
    models: z.record(z.string(), modelCostSchema).optional(),
    pricing: z
      .object({
        input: z.number(),
        output: z.number(),
        cachedInput: z.number().optional(),
        updatedAt: z.string(),
      })
      .optional(),
  })
  .partial()

/**
 * Itemized cost breakdown derived from the usage_log ledger (the single source
 * of truth) for the detail view. Each item is one billed line (base fee, a
 * model, or a tool/integration); the items reconcile to `total`.
 */
const costLedgerItemSchema = z.object({
  category: z.enum(['fixed', 'model', 'tool']),
  description: z.string(),
  cost: z.number(),
  inputTokens: z.number().optional(),
  outputTokens: z.number().optional(),
})

export const costLedgerSchema = z.object({
  total: z.number(),
  items: z.array(costLedgerItemSchema),
})

export type CostLedger = z.output<typeof costLedgerSchema>
export type CostLedgerItem = z.output<typeof costLedgerItemSchema>

const pauseSummarySchema = z.object({
  status: z.string().nullable(),
  total: z.number(),
  resumed: z.number(),
})

const blockExecutionSchema = z.object({
  id: z.string(),
  blockId: z.string(),
  blockName: z.string(),
  blockType: z.string(),
  startedAt: z.string(),
  endedAt: z.string(),
  durationMs: z.number(),
  status: z.enum(['success', 'error', 'skipped']),
  errorMessage: z.string().optional(),
  errorStackTrace: z.string().optional(),
  inputData: z.unknown(),
  outputData: z.unknown(),
  cost: costSummarySchema.optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

const toolCallSchema = z
  .object({
    id: z.string().describe('Tool-call identifier.').optional(),
    name: z.string().describe('Invoked tool name.').optional(),
    arguments: z.unknown().describe('Arguments supplied to the tool call.').optional(),
    result: z.unknown().describe('Value returned by the tool call.').optional(),
    error: z.string().describe('Tool-call error message.').optional(),
    startTime: z.string().describe('ISO 8601 tool-call start timestamp.').optional(),
    endTime: z.string().describe('ISO 8601 tool-call end timestamp.').optional(),
    duration: z.number().describe('Tool-call duration in milliseconds.').optional(),
  })
  .describe('Tool invocation captured inside a trace span.')
  .catchall(z.unknown().describe('Additional provider-specific tool-call metadata.'))

export type LogTraceSpan = {
  id: string
  name: string
  type: string
  duration?: number
  durationMs?: number
  startTime?: string
  endTime?: string
  status?: string
  errorHandled?: boolean
  errorType?: string
  errorMessage?: string
  blockId?: string
  input?: unknown
  output?: unknown
  tokens?: number | { total?: number; input?: number; output?: number }
  cost?: { total?: number; input?: number; output?: number; toolCost?: number }
  relativeStartMs?: number
  toolCalls?: Array<z.output<typeof toolCallSchema>>
  children?: LogTraceSpan[]
}

export const traceSpanSchema: z.ZodType<LogTraceSpan> = z
  .lazy(() =>
    z
      .object({
        id: z.string().describe('Trace-span identifier.'),
        name: z.string().describe('Trace-span name.'),
        type: z.string().describe('Trace-span category.'),
        duration: z.number().describe('Current trace-span duration in milliseconds.').optional(),
        durationMs: z
          .number()
          .describe(
            'Compatibility field for span duration in milliseconds. Read `duration` for current trace spans.'
          )
          .optional(),
        startTime: z.string().describe('ISO 8601 span start timestamp.').optional(),
        endTime: z.string().describe('ISO 8601 span end timestamp.').optional(),
        status: z.string().describe('Trace-span status.').optional(),
        errorHandled: z.boolean().describe('Whether the recorded error was handled.').optional(),
        errorType: z.string().describe('Recorded error type.').optional(),
        errorMessage: z.string().describe('Recorded error message.').optional(),
        blockId: z.string().describe('Workflow block associated with the span.').optional(),
        input: z.unknown().describe('Input captured for the traced operation.').optional(),
        output: z.unknown().describe('Output captured for the traced operation.').optional(),
        tokens: z
          .union([
            z.number().describe('Total tokens attributed to the span.'),
            z
              .object({
                total: z.number().describe('Total tokens.').optional(),
                input: z.number().describe('Input tokens.').optional(),
                output: z.number().describe('Output tokens.').optional(),
              })
              .describe('Token usage attributed to the span.')
              .partial(),
          ])
          .describe('Token usage attributed to the span.')
          .optional(),
        cost: z
          .object({
            total: z.number().describe('Total span cost in USD.').optional(),
            input: z.number().describe('Input-token cost in USD.').optional(),
            output: z.number().describe('Output-token cost in USD.').optional(),
            toolCost: z.number().describe('Tool cost in USD.').optional(),
          })
          .partial()
          .describe('Cost attributed to the span.')
          .optional(),
        relativeStartMs: z
          .number()
          .describe('Offset from the root span in milliseconds.')
          .optional(),
        toolCalls: z.array(toolCallSchema).describe('Tool calls recorded by the span.').optional(),
        children: z.array(traceSpanSchema).describe('Nested child trace spans.').optional(),
      })
      .catchall(z.unknown().describe('Additional provider-specific trace-span metadata.'))
  )
  .meta({
    id: 'LogTraceSpan',
    title: 'Log trace span',
    description: 'One recursive operation span in a workflow execution trace.',
  })

export const traceSpansSchema = z.array(traceSpanSchema)

const executionDataDetailSchema = z
  .object({
    totalDuration: z.number().nullable().optional(),
    enhanced: z.literal(true).optional(),
    traceSpans: traceSpansSchema.optional(),
    blockExecutions: z.array(blockExecutionSchema).optional(),
    finalOutput: z.unknown().optional(),
    workflowInput: z.unknown().optional(),
    blockInput: z.record(z.string(), z.unknown()).optional(),
    trigger: z.unknown().optional(),
  })
  .passthrough()

export const workflowLogSummarySchema = z.object({
  id: z.string(),
  workflowId: z.string().nullable(),
  executionId: z.string().nullable(),
  deploymentVersionId: z.string().nullable(),
  deploymentVersion: z.number().nullable(),
  deploymentVersionName: z.string().nullable(),
  executionOrigin: z.enum(['workflow_group']).nullable(),
  level: z.string(),
  status: z.string().nullable(),
  duration: z.string().nullable(),
  trigger: z.string().nullable(),
  createdAt: z.string(),
  workflow: workflowSummarySchema.nullable(),
  jobTitle: z.string().nullable(),
  // Top-level run cost is the cost_total projection of the usage_log ledger,
  // rendered as { total } (dollars). The itemized breakdown lives in costLedger
  // (detail only); per-block costs use the richer costSummarySchema elsewhere.
  cost: z.object({ total: z.number() }).nullable(),
  pauseSummary: pauseSummarySchema,
  hasPendingPause: z.boolean(),
})

export const workflowLogDetailSchema = workflowLogSummarySchema.extend({
  executionData: executionDataDetailSchema,
  files: z.array(userFileSchema).nullable(),
  // Itemized, ledger-sourced cost breakdown. Null for legacy/pre-ledger runs,
  // where the UI falls back to the (reconciling) cost jsonb.
  costLedger: costLedgerSchema.nullable().optional(),
})

export type WorkflowLogSummary = z.output<typeof workflowLogSummarySchema>
export type WorkflowLogDetail = z.output<typeof workflowLogDetailSchema>

/**
 * A row that may be either a list-view summary or a fully loaded detail. Used by
 * UI surfaces that render the same log before and after its detail query resolves.
 */
export type WorkflowLogRow = WorkflowLogSummary &
  Partial<Pick<WorkflowLogDetail, 'executionData' | 'files' | 'costLedger'>>

export const listLogsResponseSchema = z.object({
  data: z.array(workflowLogSummarySchema),
  nextCursor: z.string().nullable(),
  /** Total rows matching the filters; present only when `includeTotal` was set. */
  total: z.number().optional(),
})

export type ListLogsResponse = z.output<typeof listLogsResponseSchema>

export const segmentStatsSchema = z.object({
  timestamp: z.string(),
  totalExecutions: z.number(),
  successfulExecutions: z.number(),
  avgDurationMs: z.number(),
})

export const workflowStatsSchema = z.object({
  workflowId: z.string(),
  workflowName: z.string(),
  segments: z.array(segmentStatsSchema),
  overallSuccessRate: z.number(),
  totalExecutions: z.number(),
  totalSuccessful: z.number(),
})

export const dashboardStatsResponseSchema = z.object({
  workflows: z.array(workflowStatsSchema),
  aggregateSegments: z.array(segmentStatsSchema),
  totalRuns: z.number(),
  totalErrors: z.number(),
  avgLatency: z.number(),
  timeBounds: z.object({
    start: z.string(),
    end: z.string(),
  }),
  segmentMs: z.number(),
})

export const executionSnapshotDataSchema = z.object({
  executionId: z.string(),
  workflowId: z.string().nullable(),
  workflowState: z.record(z.string(), z.unknown()).nullable(),
  childWorkflowSnapshots: z.record(z.string(), z.unknown()).optional(),
  executionMetadata: z.object({
    trigger: z.string().nullable(),
    startedAt: z.string(),
    endedAt: z.string().optional(),
    totalDurationMs: z.number().nullable().optional(),
    cost: z.unknown().nullable(),
    totalTokens: z.number().nullable().optional(),
  }),
})

export type SegmentStats = z.output<typeof segmentStatsSchema>
export type WorkflowStats = z.output<typeof workflowStatsSchema>
export type DashboardStatsResponse = z.output<typeof dashboardStatsResponseSchema>
export type ExecutionSnapshotData = z.output<typeof executionSnapshotDataSchema>

export const listLogsContract = defineRouteContract({
  method: 'GET',
  path: '/api/logs',
  query: listLogsQuerySchema,
  response: {
    mode: 'json',
    schema: listLogsResponseSchema,
  },
})

export const getLogDetailContract = defineRouteContract({
  method: 'GET',
  path: '/api/logs/[id]',
  params: logIdParamsSchema,
  query: logDetailQuerySchema,
  response: {
    mode: 'json',
    schema: z.object({
      data: workflowLogDetailSchema,
    }),
  },
})

export const getLogByExecutionIdContract = defineRouteContract({
  method: 'GET',
  path: '/api/logs/by-execution/[executionId]',
  params: executionIdParamsSchema,
  query: logDetailQuerySchema,
  response: {
    mode: 'json',
    schema: z.object({
      data: workflowLogDetailSchema,
    }),
  },
})

export const getDashboardStatsContract = defineRouteContract({
  method: 'GET',
  path: '/api/logs/stats',
  query: statsQueryParamsSchema,
  response: {
    mode: 'json',
    schema: dashboardStatsResponseSchema,
  },
})

export const getExecutionSnapshotContract = defineRouteContract({
  method: 'GET',
  path: '/api/logs/execution/[executionId]',
  params: executionIdParamsSchema,
  response: {
    mode: 'json',
    schema: executionSnapshotDataSchema,
  },
})
