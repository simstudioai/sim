import { z } from 'zod'
import { traceSpansSchema } from '@/lib/api/contracts/logs'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { v1ListLogsQuerySchema } from '@/lib/api/contracts/v1/logs'
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
export const v2LogStatusSchema = z.enum(['pending', 'running', 'completed', 'failed', 'cancelled'])

/** Execution `files` is a per-run jsonb array of attachment metadata. */
const v2LogFilesSchema = z.array(z.unknown()).nullable()

const v2LogWorkflowSummarySchema = z.object({
  id: z.string().nullable(),
  name: z.string(),
  description: z.string().nullable(),
  deleted: z.boolean(),
})

export const v2LogListItemSchema = z.object({
  runId: z.string(),
  workflowId: z.string().nullable(),
  deploymentVersionId: z.string().nullable(),
  status: v2LogStatusSchema,
  level: z.string(),
  trigger: z.string(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  totalDurationMs: z.number().nullable(),
  cost: v2LogCostSchema,
  files: v2LogFilesSchema,
  /** Present only when `details=full`. */
  workflow: v2LogWorkflowSummarySchema.optional(),
  /** Present when `includeFinalOutput=true`; the flag implies full detail. */
  finalOutput: z.unknown().optional(),
  /** Present when `includeTraceSpans=true`; the flag implies full detail. */
  traceSpans: traceSpansSchema.optional(),
})

export type V2LogListItem = z.output<typeof v2LogListItemSchema>

export const v2LogDetailSchema = z.object({
  runId: z.string(),
  workflowId: z.string().nullable(),
  deploymentVersionId: z.string().nullable(),
  status: v2LogStatusSchema,
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
  /** Workflow state snapshot captured for this execution. */
  workflowState: z.unknown(),
  /** Materialized block-level execution trace spans. */
  traceSpans: traceSpansSchema,
  /** Materialized final output, when the execution produced one. */
  finalOutput: z.unknown().nullable(),
  cost: v2LogCostSchema,
  createdAt: z.string(),
})

export type V2LogDetail = z.output<typeof v2LogDetailSchema>

export const v2LogParamsSchema = z.object({
  runId: z.string().min(1, 'runId cannot be empty'),
})

export const v2ListLogsQuerySchema = v1ListLogsQuerySchema
  .omit({ executionId: true, folderIds: true })
  .extend({
    runId: z.string().min(1, 'runId cannot be empty').optional(),
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
  path: '/api/v2/logs/[runId]',
  params: v2LogParamsSchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2LogDetailSchema),
  },
})
