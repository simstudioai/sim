import { z } from 'zod'
import { booleanQueryFlagSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'

const comparisonOperatorSchema = z.enum(['=', '>', '<', '>=', '<=', '!='])

export const logIdParamsSchema = z.object({
  id: z.string().min(1),
})

export const executionIdParamsSchema = z.object({
  executionId: z.string().min(1),
})

export const v1LogParamsSchema = z.object({
  id: z.string().min(1),
})

export const v1ExecutionParamsSchema = z.object({
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

export const listLogsQuerySchema = logFilterQuerySchema.extend({
  details: z.enum(['basic', 'full']).optional().default('basic'),
  limit: z.coerce.number().optional().default(100),
  offset: z.coerce.number().optional().default(0),
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

const fileSchema = z
  .object({
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
  .passthrough()

export const workflowLogSchema = z
  .object({
    id: z.string(),
    workflowId: z.string().nullable(),
    executionId: z.string().nullable().optional(),
    deploymentVersionId: z.string().nullable().optional(),
    deploymentVersion: z.number().nullable().optional(),
    deploymentVersionName: z.string().nullable().optional(),
    level: z.string(),
    status: z.string().nullable().optional(),
    duration: z.string().nullable(),
    trigger: z.string().nullable(),
    createdAt: z.string(),
    workflow: workflowSummarySchema.nullable().optional(),
    jobTitle: z.string().nullable().optional(),
    files: z.array(fileSchema).optional(),
    cost: z.unknown().optional(),
    hasPendingPause: z.boolean().nullable().optional(),
    pauseSummary: z.unknown().optional(),
    executionData: z.unknown().optional(),
  })
  .passthrough()

export type WorkflowLogData = z.output<typeof workflowLogSchema>

export const logsResponseSchema = z.object({
  data: z.array(workflowLogSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
  totalPages: z.number(),
})

export type LogsResponse = z.output<typeof logsResponseSchema>

export const v1ListLogsQuerySchema = z.object({
  workspaceId: z.string().min(1),
  workflowIds: z.string().optional(),
  folderIds: z.string().optional(),
  triggers: z.string().optional(),
  level: z.enum(['info', 'error']).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  executionId: z.string().optional(),
  minDurationMs: z.coerce.number().optional(),
  maxDurationMs: z.coerce.number().optional(),
  minCost: z.coerce.number().optional(),
  maxCost: z.coerce.number().optional(),
  model: z.string().optional(),
  details: z.enum(['basic', 'full']).optional().default('basic'),
  includeTraceSpans: booleanQueryFlagSchema.optional().default(false),
  includeFinalOutput: booleanQueryFlagSchema.optional().default(false),
  limit: z.coerce.number().optional().default(100),
  cursor: z.string().optional(),
  order: z.enum(['desc', 'asc']).optional().default('desc'),
})

const v1ApiResponseWithLimitsSchema = z
  .object({
    limits: z.unknown().optional(),
  })
  .passthrough()

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
export type V1ListLogsQuery = z.output<typeof v1ListLogsQuerySchema>
export type V1LogParams = z.output<typeof v1LogParamsSchema>
export type V1ExecutionParams = z.output<typeof v1ExecutionParamsSchema>

export const listLogsContract = defineRouteContract({
  method: 'GET',
  path: '/api/logs',
  query: listLogsQuerySchema,
  response: {
    mode: 'json',
    schema: logsResponseSchema,
  },
})

export const getLogDetailContract = defineRouteContract({
  method: 'GET',
  path: '/api/logs/[id]',
  params: logIdParamsSchema,
  response: {
    mode: 'json',
    schema: z.object({
      data: workflowLogSchema,
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

export const v1ListLogsContract = defineRouteContract({
  method: 'GET',
  path: '/api/v1/logs',
  query: v1ListLogsQuerySchema,
  response: {
    mode: 'json',
    schema: v1ApiResponseWithLimitsSchema,
  },
})

export const v1GetLogContract = defineRouteContract({
  method: 'GET',
  path: '/api/v1/logs/[id]',
  params: v1LogParamsSchema,
  response: {
    mode: 'json',
    schema: v1ApiResponseWithLimitsSchema,
  },
})

export const v1GetExecutionContract = defineRouteContract({
  method: 'GET',
  path: '/api/v1/logs/executions/[executionId]',
  params: v1ExecutionParamsSchema,
  response: {
    mode: 'json',
    schema: v1ApiResponseWithLimitsSchema,
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
