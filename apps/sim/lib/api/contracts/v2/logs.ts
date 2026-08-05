import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'
import {
  v1ExecutionParamsSchema,
  v1ListLogsQuerySchema,
  v1LogParamsSchema,
} from '@/lib/api/contracts/v1/logs'
import {
  v2CursorListResponse,
  v2DataResponse,
  v2FolderPathInputSchema,
  v2FolderPathSchema,
} from '@/lib/api/contracts/v2/shared'

/**
 * v2 logs contracts. The query schemas are reused verbatim from v1 (the request
 * shape is unchanged); only the response envelope is upgraded to the canonical
 * v2 shapes with concrete item schemas.
 */

const v2LogCostSchema = z.object({ total: z.number() }).nullable()

/** Execution `files` is a per-run jsonb array of attachment metadata. */
const v2LogFilesSchema = z.array(z.unknown()).nullable()

const v2LogWorkflowSummarySchema = z.object({
  id: z.string().nullable(),
  name: z.string(),
  description: z.string().nullable(),
  deleted: z.boolean(),
})

export const v2LogListItemSchema = z.object({
  id: z.string(),
  workflowId: z.string().nullable(),
  executionId: z.string(),
  deploymentVersionId: z.string().nullable(),
  level: z.string(),
  trigger: z.string(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  totalDurationMs: z.number().nullable(),
  cost: v2LogCostSchema,
  files: v2LogFilesSchema,
  /** Present only when `details=full`. */
  workflow: v2LogWorkflowSummarySchema.optional(),
  /** Present only when `details=full` and `includeFinalOutput=true`. */
  finalOutput: z.unknown().optional(),
  /** Present only when `details=full` and `includeTraceSpans=true`. */
  traceSpans: z.unknown().optional(),
})

export type V2LogListItem = z.output<typeof v2LogListItemSchema>

export const v2LogDetailSchema = z.object({
  id: z.string(),
  workflowId: z.string().nullable(),
  executionId: z.string(),
  level: z.string(),
  trigger: z.string(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  totalDurationMs: z.number().nullable(),
  files: v2LogFilesSchema,
  workflow: z.object({
    id: z.string().nullable(),
    name: z.string(),
    description: z.string().nullable(),
    folderPath: v2FolderPathSchema.nullable(),
    userId: z.string().nullable(),
    workspaceId: z.string().nullable(),
    createdAt: z.string().nullable(),
    updatedAt: z.string().nullable(),
    deleted: z.boolean(),
  }),
  /** Materialized execution trace (block states, trace spans). */
  executionData: z.unknown(),
  cost: v2LogCostSchema,
  createdAt: z.string(),
})

export type V2LogDetail = z.output<typeof v2LogDetailSchema>

export const v2ExecutionSchema = z.object({
  executionId: z.string(),
  workflowId: z.string().nullable(),
  /** Workflow state snapshot at execution time. */
  workflowState: z.unknown(),
  executionMetadata: z.object({
    trigger: z.string(),
    startedAt: z.string(),
    endedAt: z.string().nullable(),
    totalDurationMs: z.number().nullable(),
    cost: v2LogCostSchema,
  }),
})

export type V2Execution = z.output<typeof v2ExecutionSchema>

export const v2ListLogsQuerySchema = v1ListLogsQuerySchema
  .omit({ folderIds: true })
  .extend({
    folderPaths: z
      .string()
      .optional()
      .transform((value, ctx) => {
        if (value === undefined) return undefined
        const paths = value.split(',')
        if (paths.length === 0 || paths.some((path) => path.length === 0)) {
          ctx.addIssue({ code: 'custom', message: 'folderPaths must contain valid paths' })
          return z.NEVER
        }

        const normalizedPaths: string[] = []
        for (const path of paths) {
          const parsed = v2FolderPathInputSchema.safeParse(path)
          if (!parsed.success) {
            ctx.addIssue({ code: 'custom', message: 'folderPaths must contain valid paths' })
            return z.NEVER
          }
          normalizedPaths.push(parsed.data)
        }
        return normalizedPaths.join(',')
      }),
  })
  .strict()

export const v2ListLogsContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/logs',
  query: v2ListLogsQuerySchema,
  response: {
    mode: 'json',
    schema: v2CursorListResponse(v2LogListItemSchema),
  },
})

export const v2GetLogContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/logs/[id]',
  params: v1LogParamsSchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2LogDetailSchema),
  },
})

export const v2GetExecutionContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/logs/executions/[executionId]',
  params: v1ExecutionParamsSchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2ExecutionSchema),
  },
})
