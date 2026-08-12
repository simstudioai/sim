import { z } from 'zod'
import { traceSpansSchema } from '@/lib/api/contracts/logs'
import { booleanQueryFlagSchema, workspaceIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { v1ListLogsQuerySchema } from '@/lib/api/contracts/v1/logs'
import {
  v2CursorListResponse,
  v2DataResponse,
  v2FolderPathInputSchema,
  v2FolderPathSchema,
  v2TimestampSchema,
} from '@/lib/api/contracts/v2/shared'
import { PERSISTED_WORKFLOW_EXECUTION_STATUSES } from '@/lib/logs/types'

/**
 * v2 logs contracts. The query schemas are reused verbatim from v1 (the request
 * shape is unchanged); only the response envelope is upgraded to the canonical
 * v2 shapes with concrete item schemas.
 */

const v2LogCostSchema = z
  .object({ total: z.number().describe('Total execution cost in USD.') })
  .nullable()
  .describe('Cost charged for the run, or null when unavailable.')
/**
 * Both log endpoints pass `workflow_execution_logs.status` through verbatim, so the
 * reported set is exactly the persisted set — a value missing here fails the response
 * parse, and because list validation is whole-page one such row turns an entire page
 * into a 500.
 */
export const v2LogStatusSchema = z
  .enum(PERSISTED_WORKFLOW_EXECUTION_STATUSES)
  .describe(
    'Current execution status. `redacting` is transient while run output is scrubbed. `paused` is reported when a resume attempt did not run to completion and the run is waiting to be resumed again.'
  )

/** Execution `files` is a per-run jsonb array of attachment metadata. */
const v2LogFilesSchema = z
  .array(z.unknown().describe('Attachment metadata captured for the execution.'))
  .nullable()
  .describe('Files attached to the run, or null when none are recorded.')

/**
 * The graph as executed, sourced from the run's snapshot row. Declared loose because the
 * snapshot is a stored jsonb blob whose interior evolves with the block registry, and the
 * response is re-parsed on the way out — a strict shape would silently strip block fields a
 * diagnostic consumer depends on, or reject an older snapshot outright. `null` when the run's
 * snapshot has aged out of retention.
 *
 * Looseness means the response parse cannot enforce redaction: credential values are nulled in
 * the `getPublicLog` use case, which is the single point of truth for what this field may carry.
 */
const v2LogWorkflowStateSchema = z
  .object({})
  .catchall(
    z
      .unknown()
      .describe(
        'One top-level snapshot section — `blocks`, `edges`, `loops`, `parallels`, or `variables` — passed through as stored.'
      )
  )
  .nullable()
  .describe(
    'Workflow graph snapshot captured for the run, with credential values redacted: `oauth-input`, `password: true`, and table sub-block values are null; sensitive nested tool parameters and every parameter without authoritative codec metadata are null; and `{{VAR}}` references in non-opaque fields are preserved. Null when no snapshot is retained.'
  )

const v2LogWorkflowSummarySchema = z.object({
  id: z.string().nullable().describe('Workflow identifier, or null when unavailable.'),
  name: z.string().describe('Workflow name.'),
  description: z.string().nullable().describe('Workflow description, or null when unset.'),
  deleted: z.boolean().describe('Whether the workflow has been deleted.'),
})

export const v2LogListItemSchema = z
  .object({
    runId: z.string().describe('Unique run identifier.'),
    workflowId: z.string().nullable().describe('Workflow identifier, or null when unavailable.'),
    deploymentVersionId: z
      .string()
      .nullable()
      .describe('Deployment version identifier, or null when unavailable.'),
    status: v2LogStatusSchema,
    level: z.string().describe('Log severity level.'),
    trigger: z.string().describe('Trigger that started the run.'),
    startedAt: v2TimestampSchema.describe('ISO 8601 execution start timestamp.'),
    endedAt: v2TimestampSchema
      .nullable()
      .describe('ISO 8601 execution end timestamp, or null while the run is active.'),
    totalDurationMs: z
      .number()
      .nullable()
      .describe('Total execution duration in milliseconds, or null while unavailable.'),
    cost: v2LogCostSchema,
    files: v2LogFilesSchema,
    /** Present only when `details=full`. */
    workflow: v2LogWorkflowSummarySchema
      .describe('Workflow summary for a full-detail result.')
      .optional(),
    /** Present when `includeFinalOutput=true`; the flag implies full detail. */
    finalOutput: z.unknown().describe('Final workflow output.').optional(),
    /** Present when `includeTraceSpans=true`; the flag implies full detail. */
    traceSpans: traceSpansSchema.describe('Block-level execution trace spans.').optional(),
  })
  .meta({
    id: 'V2LogListItem',
    title: 'Execution log summary',
    description: 'Summary information for one workflow execution log.',
  })

export type V2LogListItem = z.output<typeof v2LogListItemSchema>

export const v2LogDetailSchema = z
  .object({
    runId: z.string().describe('Unique run identifier.'),
    workflowId: z.string().nullable().describe('Workflow identifier, or null when unavailable.'),
    deploymentVersionId: z
      .string()
      .nullable()
      .describe('Deployment version identifier, or null when unavailable.'),
    status: v2LogStatusSchema,
    level: z.string().describe('Log severity level.'),
    trigger: z.string().describe('Trigger that started the run.'),
    startedAt: v2TimestampSchema.describe('ISO 8601 execution start timestamp.'),
    endedAt: v2TimestampSchema
      .nullable()
      .describe('ISO 8601 execution end timestamp, or null while the run is active.'),
    totalDurationMs: z
      .number()
      .nullable()
      .describe('Total execution duration in milliseconds, or null while unavailable.'),
    files: v2LogFilesSchema,
    workflow: z
      .object({
        id: z.string().nullable().describe('Workflow identifier, or null when unavailable.'),
        name: z.string().describe('Workflow name.'),
        description: z.string().nullable().describe('Workflow description, or null when unset.'),
        folderPath: v2FolderPathSchema
          .nullable()
          .describe('Workflow folder path, or null when unavailable.'),
        ownerEmail: z
          .email()
          .nullable()
          .describe('Workflow owner email, or null when unavailable.'),
        workspaceId: z
          .string()
          .nullable()
          .describe('Owning workspace identifier, or null when unavailable.'),
        createdAt: v2TimestampSchema
          .nullable()
          .describe('ISO 8601 workflow creation timestamp, or null when unavailable.'),
        updatedAt: v2TimestampSchema
          .nullable()
          .describe('ISO 8601 workflow update timestamp, or null when unavailable.'),
        deleted: z.boolean().describe('Whether the workflow has been deleted.'),
      })
      .describe('Workflow snapshot associated with the execution.'),
    workflowState: v2LogWorkflowStateSchema,
    /** Materialized block-level execution trace spans. */
    traceSpans: traceSpansSchema.describe('Materialized block-level execution trace spans.'),
    /** Materialized final output, when the execution produced one. */
    finalOutput: z
      .unknown()
      .describe('Materialized final workflow output value.')
      .nullable()
      .describe('Materialized final workflow output, or null when none was produced.'),
    cost: v2LogCostSchema,
    createdAt: v2TimestampSchema.describe('ISO 8601 log creation timestamp.'),
  })
  .meta({
    id: 'V2LogDetail',
    title: 'Execution log detail',
    description: 'Detailed workflow execution log including state, trace, output, and cost.',
  })

export type V2LogDetail = z.output<typeof v2LogDetailSchema>

export const v2LogParamsSchema = z.object({
  runId: z
    .string()
    .min(1, 'runId cannot be empty')
    .describe('The unique run identifier shared by lifecycle and diagnostic resources.'),
})

export const v2ListLogsQuerySchema = v1ListLogsQuerySchema
  .omit({ executionId: true, folderIds: true })
  .extend({
    workspaceId: workspaceIdSchema.describe('Workspace whose execution logs should be returned.'),
    workflowIds: z.string().describe('Comma-separated workflow identifiers to include.').optional(),
    triggers: z.string().describe('Comma-separated trigger types to include.').optional(),
    level: z.enum(['info', 'error']).describe('Severity level to include.').optional(),
    startDate: z
      .string()
      .describe('Only include runs started at or after this ISO 8601 timestamp.')
      .optional(),
    endDate: z
      .string()
      .describe('Only include runs started at or before this ISO 8601 timestamp.')
      .optional(),
    runId: z
      .string()
      .min(1, 'runId cannot be empty')
      .describe('Exact run identifier to match.')
      .optional(),
    minDurationMs: z.coerce
      .number()
      .describe('Minimum total execution duration in milliseconds.')
      .optional(),
    maxDurationMs: z.coerce
      .number()
      .describe('Maximum total execution duration in milliseconds.')
      .optional(),
    minCost: z.coerce.number().describe('Minimum execution cost in USD.').optional(),
    maxCost: z.coerce.number().describe('Maximum execution cost in USD.').optional(),
    model: z.string().describe('AI model used during execution.').optional(),
    details: z
      .enum(['basic', 'full'])
      .describe('Response detail level.')
      .optional()
      .default('basic'),
    includeTraceSpans: booleanQueryFlagSchema
      .describe('Whether to include block-level trace spans.')
      .optional()
      .default(false),
    includeFinalOutput: booleanQueryFlagSchema
      .describe('Whether to include the final workflow output.')
      .optional()
      .default(false),
    limit: z.coerce
      .number()
      .optional()
      .default(100)
      .transform((value) => Math.min(Math.max(1, Math.trunc(value)), 1000))
      .describe('Maximum log entries per page, clamped to 1–1000.'),
    cursor: z.string().describe('Opaque cursor returned by a previous page.').optional(),
    order: z
      .enum(['desc', 'asc'])
      .describe('Sort order by execution start time.')
      .optional()
      .default('desc'),
    folderPaths: z
      .string()
      .describe('Comma-separated workflow folder paths to include.')
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
