import { z } from 'zod'
import { booleanQueryFlagSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const v1LogParamsSchema = z.object({
  id: z.string().min(1),
})

export const v1ExecutionParamsSchema = z.object({
  executionId: z.string().min(1),
})

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

export type V1ListLogsQuery = z.output<typeof v1ListLogsQuerySchema>
export type V1LogParams = z.output<typeof v1LogParamsSchema>
export type V1ExecutionParams = z.output<typeof v1ExecutionParamsSchema>

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
