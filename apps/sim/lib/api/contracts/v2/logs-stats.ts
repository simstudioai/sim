import { z } from 'zod'
import { MAX_STATS_SEGMENT_COUNT, MAX_STATS_WORKFLOWS } from '@/lib/api/contracts/logs'
import { workspaceIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import {
  V2_FOLDER_FILTER_MISS,
  v2DataResponse,
  v2FolderPathInputSchema,
  v2RunWindowBoundSchema,
  v2TimestampSchema,
} from '@/lib/api/contracts/v2/shared'

/**
 * The default number of buckets, matching the first-party dashboard so the two
 * surfaces summarize a workspace the same way by default.
 */
const DEFAULT_SEGMENT_COUNT = 72

/**
 * Number of time buckets the window is divided into.
 *
 * Bounded on every side, and the bounds are the point. Unbounded, this value is
 * the length of two densely materialized arrays — one per workflow series, one
 * for the aggregate — so `1e9` allocates two billion-element arrays; `0` divides
 * by zero deriving the bucket width; and a fractional value indexes between
 * buckets. All three were reachable from the query string on the first-party
 * schema this replaces, and each produced a 500 for a well-formed request.
 */
const v2SegmentCountSchema = z.coerce
  .number()
  .int('segmentCount must be a whole number')
  .min(1, 'segmentCount must be at least 1')
  .max(MAX_STATS_SEGMENT_COUNT, `segmentCount cannot exceed ${MAX_STATS_SEGMENT_COUNT}`)
  .optional()
  .default(DEFAULT_SEGMENT_COUNT)
  .describe(
    `Number of time buckets, up to ${MAX_STATS_SEGMENT_COUNT}. Exactly this many are returned, each at least one minute wide. Short windows extend past the requested end and include empty trailing buckets.`
  )

const v2LogSegmentSchema = z
  .object({
    timestamp: v2TimestampSchema.describe('ISO 8601 start of the bucket.'),
    totalExecutions: z.number().describe('Runs that started inside the bucket.'),
    successfulExecutions: z.number().describe('Runs in the bucket that did not error.'),
    avgDurationMs: z
      .number()
      .describe(
        "Mean duration of the bucket's runs in milliseconds, weighted by run count. Zero when no run in the bucket recorded a duration."
      ),
  })
  .meta({
    id: 'V2LogStatsSegment',
    title: 'Log stats bucket',
    description: 'Run counts and mean latency for one time bucket.',
  })

const v2WorkflowLogStatsSchema = z
  .object({
    workflowId: z
      .string()
      .describe(
        'Workflow identifier, or the literal `deleted` for the single series that collects runs whose workflow no longer exists.'
      ),
    workflowName: z.string().describe('Workflow name, or `Deleted Workflow`.'),
    segments: z
      .array(v2LogSegmentSchema)
      .describe('One entry per bucket, in order, including buckets with no runs.'),
    totalExecutions: z.number().describe('Runs for this workflow across the window.'),
    totalSuccessful: z.number().describe('Runs for this workflow that did not error.'),
    overallSuccessRate: z
      .number()
      .describe(
        'Percentage of runs that did not error, from 0 to 100. 100 when there were no runs.'
      ),
  })
  .meta({
    id: 'V2WorkflowLogStats',
    title: 'Per-workflow log stats',
    description: 'Bucketed run counts and success rate for one workflow.',
  })

export const v2LogStatsSchema = z
  .object({
    workflows: z
      .array(v2WorkflowLogStatsSchema)
      .describe(
        `Per-workflow series, ordered by error rate descending then by name, capped at ${MAX_STATS_WORKFLOWS} entries.`
      ),
    workflowsTruncated: z
      .boolean()
      .describe(
        `Whether \`workflows\` was cut to ${MAX_STATS_WORKFLOWS} entries. The workspace totals and \`aggregateSegments\` are computed from every workflow before the cut, so they stay exact either way.`
      ),
    aggregateSegments: z
      .array(v2LogSegmentSchema)
      .describe('Workspace-wide totals per bucket, in the same order as each workflow series.'),
    totalRuns: z.number().describe('Runs in the window across the whole workspace.'),
    totalErrors: z.number().describe('Runs in the window that errored.'),
    avgLatency: z
      .number()
      .describe('Mean run duration in milliseconds across the window, weighted by run count.'),
    timeBounds: z
      .object({
        start: v2TimestampSchema.describe('ISO 8601 start of the window.'),
        end: v2TimestampSchema.describe('ISO 8601 end of the window.'),
      })
      .describe(
        'Actual bucket window. Supplied bounds are exact. Without `startDate`, the left edge is the oldest match, or 24 hours before the right edge when no run matches. Without `endDate`, the right edge is at least now. `startDate` alone spans through now.'
      ),
    segmentMs: z.number().describe('Width of one bucket in milliseconds.'),
  })
  .meta({
    id: 'V2LogStats',
    title: 'Execution log statistics',
    description:
      'Bucketed success rate, error count, and latency for a workspace and each of its workflows.',
  })

export type V2LogStats = z.output<typeof v2LogStatsSchema>

import {
  V2_LOG_FOLDER_PATHS_MAX,
  V2_LOG_TRIGGERS_MAX,
  V2_LOG_WORKFLOW_IDS_MAX,
} from '@/lib/api/contracts/v2/logs'

export const v2LogStatsQuerySchema = z
  .object({
    workspaceId: workspaceIdSchema.describe('Workspace whose execution statistics to summarize.'),
    workflowIds: z
      .string()
      .describe(
        `Comma-separated workflow identifiers to include. At most ${V2_LOG_WORKFLOW_IDS_MAX} entries. An empty entry is rejected.`
      )
      .refine((value) => value.split(',').every((entry) => entry.length > 0), {
        error: 'workflowIds must not contain an empty entry',
      })
      .refine((value) => value.split(',').length <= V2_LOG_WORKFLOW_IDS_MAX, {
        error: `workflowIds cannot contain more than ${V2_LOG_WORKFLOW_IDS_MAX} entries`,
      })
      .optional(),
    folderPaths: z
      .string()
      .describe(
        `Comma-separated workflow folder paths, including descendants. Up to ${V2_LOG_FOLDER_PATHS_MAX} paths. ${V2_FOLDER_FILTER_MISS}`
      )
      .optional()
      .transform((value, ctx) => {
        if (value === undefined) return undefined
        const paths = value.split(',')
        if (paths.length === 0 || paths.some((path) => path.length === 0)) {
          ctx.addIssue({ code: 'custom', message: 'folderPaths must contain valid paths' })
          return z.NEVER
        }
        if (paths.length > V2_LOG_FOLDER_PATHS_MAX) {
          ctx.addIssue({
            code: 'custom',
            message: `folderPaths cannot contain more than ${V2_LOG_FOLDER_PATHS_MAX} entries`,
          })
          return z.NEVER
        }
        const normalized: string[] = []
        for (const path of paths) {
          const parsed = v2FolderPathInputSchema.safeParse(path)
          if (!parsed.success) {
            ctx.addIssue({ code: 'custom', message: 'folderPaths must contain valid paths' })
            return z.NEVER
          }
          normalized.push(parsed.data)
        }
        return normalized.join(',')
      }),
    triggers: z
      .string()
      .describe(
        'Comma-separated trigger types to include. An empty entry is rejected. The vocabulary is open, so an unrecognized member selects no runs; the literal `all` disables this filter.'
      )
      .refine((value) => value.split(',').every((entry) => entry.length > 0), {
        error: 'triggers must not contain an empty entry',
      })
      .refine((value) => value.split(',').length <= V2_LOG_TRIGGERS_MAX, {
        error: `triggers cannot contain more than ${V2_LOG_TRIGGERS_MAX} entries`,
      })
      .optional(),
    level: z.enum(['info', 'error']).describe('Severity level to include.').optional(),
    startDate: v2RunWindowBoundSchema('startDate').optional(),
    endDate: v2RunWindowBoundSchema('endDate').optional(),
    segmentCount: v2SegmentCountSchema,
  })
  .strict()
  .refine(
    (query) =>
      !query.startDate ||
      !query.endDate ||
      Date.parse(query.startDate) <= Date.parse(query.endDate),
    { error: 'startDate must be before or equal to endDate', path: ['startDate'] }
  )

export const v2GetLogStatsContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/logs/stats',
  query: v2LogStatsQuerySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2LogStatsSchema),
  },
})
