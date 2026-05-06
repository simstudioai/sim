import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'

const comparisonOperatorSchema = z.enum(['=', '>', '<', '>=', '<=', '!='])

export const logIdParamsSchema = z.object({
  id: z.string().min(1),
})

export const executionIdParamsSchema = z.object({
  executionId: z.string().min(1),
})

export const cancelWorkflowExecutionParamsSchema = z.object({
  id: z.string().min(1, 'Invalid workflow ID'),
  executionId: z.string().min(1, 'Invalid execution ID'),
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
})

export const logDetailQuerySchema = z.object({
  workspaceId: z.string().min(1),
})

export const statsQueryParamsSchema = logFilterQuerySchema.extend({
  segmentCount: z.coerce.number().optional().default(72),
})

const workflowSummarySchema = z
  .object({
    id: z.string(),
    name: z.string().nullable(),
    description: z.string().nullable(),
    color: z.string().nullable(),
    folderId: z.string().nullable(),
    userId: z.string().nullable(),
    workspaceId: z.string().nullable(),
    createdAt: z.string().nullable(),
    updatedAt: z.string().nullable(),
  })
  .partial()

const fileSchema = z.object({
  id: z.string(),
  name: z.string(),
  size: z.number(),
  type: z.string(),
  url: z.string(),
  key: z.string(),
  uploadedAt: z.string(),
  expiresAt: z.string(),
  storageProvider: z.enum(['s3', 'blob', 'local']).optional(),
  bucketName: z.string().optional(),
})

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
    id: z.string().optional(),
    name: z.string().optional(),
    arguments: z.unknown().optional(),
    result: z.unknown().optional(),
    error: z.string().optional(),
    startTime: z.string().optional(),
    endTime: z.string().optional(),
    duration: z.number().optional(),
  })
  .passthrough()

type TraceSpan = {
  id: string
  name: string
  type: string
  duration?: number
  durationMs?: number
  startTime?: string
  endTime?: string
  status?: string
  blockId?: string
  input?: unknown
  output?: unknown
  tokens?: number | { total?: number; input?: number; output?: number }
  relativeStartMs?: number
  toolCalls?: Array<z.output<typeof toolCallSchema>>
  children?: TraceSpan[]
}

const traceSpanSchema: z.ZodType<TraceSpan> = z.lazy(() =>
  z
    .object({
      id: z.string(),
      name: z.string(),
      type: z.string(),
      duration: z.number().optional(),
      durationMs: z.number().optional(),
      startTime: z.string().optional(),
      endTime: z.string().optional(),
      status: z.string().optional(),
      blockId: z.string().optional(),
      input: z.unknown().optional(),
      output: z.unknown().optional(),
      tokens: z
        .union([
          z.number(),
          z
            .object({
              total: z.number().optional(),
              input: z.number().optional(),
              output: z.number().optional(),
            })
            .partial(),
        ])
        .optional(),
      relativeStartMs: z.number().optional(),
      toolCalls: z.array(toolCallSchema).optional(),
      children: z.array(traceSpanSchema).optional(),
    })
    .passthrough()
)

const executionDataDetailSchema = z
  .object({
    totalDuration: z.number().nullable().optional(),
    enhanced: z.literal(true).optional(),
    traceSpans: z.array(traceSpanSchema).optional(),
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
  level: z.string(),
  status: z.string().nullable(),
  duration: z.string().nullable(),
  trigger: z.string().nullable(),
  createdAt: z.string(),
  workflow: workflowSummarySchema.nullable(),
  jobTitle: z.string().nullable(),
  cost: costSummarySchema.nullable(),
  pauseSummary: pauseSummarySchema,
  hasPendingPause: z.boolean(),
})

export const workflowLogDetailSchema = workflowLogSummarySchema.extend({
  executionData: executionDataDetailSchema,
  files: z.array(fileSchema).nullable(),
})

export type WorkflowLogSummary = z.output<typeof workflowLogSummarySchema>
export type WorkflowLogDetail = z.output<typeof workflowLogDetailSchema>

/**
 * A row that may be either a list-view summary or a fully loaded detail. Used by
 * UI surfaces that render the same log before and after its detail query resolves.
 */
export type WorkflowLogRow = WorkflowLogSummary &
  Partial<Pick<WorkflowLogDetail, 'executionData' | 'files'>>

export const listLogsResponseSchema = z.object({
  data: z.array(workflowLogSummarySchema),
  nextCursor: z.string().nullable(),
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

export const triggersQuerySchema = z.object({
  workspaceId: z.string(),
})
export type TriggersQuery = z.output<typeof triggersQuerySchema>

export const cancelWorkflowExecutionResponseSchema = z.object({
  success: z.boolean(),
  executionId: z.string(),
  redisAvailable: z.boolean(),
  durablyRecorded: z.boolean(),
  locallyAborted: z.boolean(),
  pausedCancelled: z.boolean(),
  reason: z.enum(['recorded', 'redis_unavailable', 'redis_write_failed']),
})

export type SegmentStats = z.output<typeof segmentStatsSchema>
export type WorkflowStats = z.output<typeof workflowStatsSchema>
export type DashboardStatsResponse = z.output<typeof dashboardStatsResponseSchema>
export type ExecutionSnapshotData = z.output<typeof executionSnapshotDataSchema>
export type CancelWorkflowExecutionResponse = z.output<typeof cancelWorkflowExecutionResponseSchema>

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

export const cancelWorkflowExecutionContract = defineRouteContract({
  method: 'POST',
  path: '/api/workflows/[id]/executions/[executionId]/cancel',
  params: cancelWorkflowExecutionParamsSchema,
  response: {
    mode: 'json',
    schema: cancelWorkflowExecutionResponseSchema,
  },
})
