import { z } from 'zod'
import { traceSpansSchema } from '@/lib/api/contracts/logs'
import {
  booleanQueryFlagSchema,
  noInputSchema,
  runIdSchema,
  workspaceIdSchema,
} from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { v1ListLogsQuerySchema } from '@/lib/api/contracts/v1/logs'
import {
  V2_FOLDER_FILTER_MISS,
  v2CursorListResponse,
  v2DataResponse,
  v2FolderPathInputSchema,
  v2FolderPathSchema,
  v2PaginationFields,
  v2RunOrderSchema,
  v2RunWindowBoundSchema,
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
 *
 * That pass-through is also why this field disagrees with the run resources for the
 * same run, and the disagreement is documented rather than reconciled. The run list
 * projects `paused` over the persisted value whenever the run holds a `paused` or
 * `partially_resumed` row in `paused_executions` (`executionStatus` in
 * `lib/workflows/executor/execution-queries.ts`), so an ordinary human-in-the-loop
 * pause reads `paused` there and `pending` here. Adopting the overlay would need this
 * read to join `paused_executions`, and would silently move live runs between the
 * `pending` and `paused` buckets of a shipped field that internal log consumers read
 * from the same query — a breaking change, not a correction. Callers that need the
 * pause distinction read the run resources, which also carry the `paused` object that
 * separates "waiting on a human" from "a resume attempt failed".
 */
export const v2LogStatusSchema = z
  .enum(PERSISTED_WORKFLOW_EXECUTION_STATUSES)
  .describe(
    'Current execution status, reported as persisted. `redacting` is transient while run output is scrubbed. `paused` is reported only when a resume attempt did not complete; a run held at a human-in-the-loop pause point reads `pending` here, and `paused` on the workflow run resources. Use those when the pause state matters.'
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
    'Workflow graph snapshot captured for the run, or null when none is retained. Credential-bearing values are redacted to null: `oauth-input`, `password: true`, table sub-block values, sensitive nested tool parameters, and any parameter without authoritative codec metadata. `{{VAR}}` references in non-opaque fields are preserved.'
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
          .describe(
            'Canonical folder path of the workflow, in the same form `folderPaths` accepts as a filter: `/` for a workflow at the workspace root. Null only when the path cannot be resolved — the folder has been deleted, or the workflow itself no longer exists.'
          ),
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
  runId: runIdSchema.describe('Unique workflow run identifier.'),
})

/**
 * Upper bound of `workflow_execution_logs.total_duration_ms`, whose column is a
 * Postgres `integer`.
 *
 * The same rule `DEPLOYMENT_VERSION_MAX` states for deployment versions: a
 * comparison against an `integer` column is an `integer` comparison, so a bound
 * outside int4 — or one carrying a fractional part — is not a filter that
 * matches nothing, it is a value Postgres refuses to parse. `1.5`,
 * `2147483648`, and `1e30` each reached the query as a bind parameter and came
 * back as a 500 on a read the caller had every reason to believe was well
 * formed.
 */
const V2_DURATION_MS_MAX = 2147483647

/**
 * A duration bound, in the units and range its column can hold.
 *
 * Whole milliseconds rather than a coerced `number`, because the column is
 * `integer`: publishing `number` invited exactly the fractional value Postgres
 * cannot compare. Non-negative for the same reason the column is — a run cannot
 * last less than no time — so a negative bound is a caller mistake rather than a
 * filter that happens to match everything or nothing.
 */
function v2DurationBoundSchema(
  field: 'minDurationMs' | 'maxDurationMs',
  bound: 'Minimum' | 'Maximum'
) {
  return z.coerce
    .number()
    .int(`${field} must be a whole number of milliseconds`)
    .min(0, `${field} must not be negative`)
    .max(V2_DURATION_MS_MAX, `${field} must be at most ${V2_DURATION_MS_MAX}`)
    .describe(
      `${bound} total execution duration in milliseconds. Whole milliseconds from 0 to ${V2_DURATION_MS_MAX}; the stored duration is a 32-bit integer, so a fractional or out-of-range bound is rejected.`
    )
}

/**
 * Largest run cost, in USD, a caller may bound the search by.
 *
 * `cost_total` is an unconstrained `numeric`, so unlike the duration bounds
 * there is no storage limit to borrow; this is a policy ceiling set far above
 * any cost a single run can accrue. A bound past it cannot select anything the
 * caller could not select with a smaller one, so it is a mistyped value rather
 * than a filter.
 */
const V2_COST_USD_MAX = 1_000_000

/**
 * A cost bound, in the range its column can hold.
 *
 * Fractional values are kept — a run costs fractions of a cent — but a negative
 * bound is rejected for the same reason a negative duration is: `cost_total` is
 * never below zero, so `minCost=-1` is not a filter that matches everything, it
 * is a caller mistake reported as a full result set.
 */
function v2CostBoundSchema(field: 'minCost' | 'maxCost', bound: 'Minimum' | 'Maximum') {
  return z.coerce
    .number()
    .min(0, `${field} must not be negative`)
    .max(V2_COST_USD_MAX, `${field} must be at most ${V2_COST_USD_MAX}`)
    .describe(
      `${bound} execution cost in USD, from 0 to ${V2_COST_USD_MAX}. A run is never charged a negative amount, so a negative bound is rejected rather than treated as a filter that matches every run.`
    )
}

/**
 * A comma-separated filter list, with an empty entry rejected rather than dropped.
 *
 * `folderPaths` already refused `/,` while its two siblings on the same operation
 * silently discarded the empty entry, so one endpoint answered two ways to one
 * mistake. Rejecting is the half that matches the surface-wide rule for a blank
 * value (`V2_PARSE_DEFAULTS.rejectBlankQueryValues`): dropping it turns a
 * malformed list into a narrower filter and reports nothing, which on a log
 * search reads as "those runs do not exist".
 */
function v2CommaListSchema(field: 'workflowIds' | 'triggers', description: string) {
  return z
    .string()
    .describe(description)
    .refine((value) => value.split(',').every((entry) => entry.length > 0), {
      error: `${field} must not contain an empty entry`,
    })
}

export const v2ListLogsQuerySchema = v1ListLogsQuerySchema
  .omit({ executionId: true, folderIds: true })
  .extend({
    workspaceId: workspaceIdSchema.describe('Workspace whose execution logs should be returned.'),
    workflowIds: v2CommaListSchema(
      'workflowIds',
      'Comma-separated workflow identifiers to include. An empty entry is rejected.'
    ).optional(),
    /**
     * Not a closed enum, which is why an unrecognized member is not a 400.
     * `workflow_execution_logs.trigger` holds the core trigger types *and* the
     * webhook provider id a run arrived on — `executeWebhookJobInternal` passes
     * `payload.provider` straight through as the trigger — so the live
     * vocabulary is the union of the core set and every webhook provider that
     * has ever fired, including spellings retired since (`microsoft-teams`
     * alongside `microsoftteams`). Pinning an enum here would reject the
     * historical values a diagnostic search exists to find, so the filter states
     * that an unmatched member simply selects nothing rather than pretending to
     * validate one.
     *
     * Matching is exact and case-sensitive because the column is: every value
     * ever written is lowercase, so `API` and `ALL` name nothing. They are
     * caller mistakes, but the boundary cannot tell them apart from an unknown
     * provider id, and normalizing case here would silently repair one class of
     * typo while leaving the rest — so the case rule is documented instead.
     */
    triggers: v2CommaListSchema(
      'triggers',
      'Comma-separated trigger types to include. An empty entry is rejected. Values are matched exactly and are case-sensitive — every recorded trigger is lowercase, so `API` matches nothing while `api` matches. The vocabulary is open: it covers the core trigger types (`manual`, `api`, `schedule`, `chat`, `webhook`, `mcp`, `copilot`, `workflow`, `custom_block`) and the provider id of any webhook trigger (`slack`, `gmail`, `github`, …), so an unrecognized member is not rejected — it selects no runs. The literal value `all` is a sentinel that disables this filter entirely, so a list containing it returns runs of every trigger type; no real trigger type is named `all`.'
    ).optional(),
    level: z.enum(['info', 'error']).describe('Severity level to include.').optional(),
    startDate: v2RunWindowBoundSchema('startDate').optional(),
    endDate: v2RunWindowBoundSchema('endDate').optional(),
    runId: runIdSchema.describe('Exact run identifier to match.').optional(),
    minDurationMs: v2DurationBoundSchema('minDurationMs', 'Minimum').optional(),
    maxDurationMs: v2DurationBoundSchema('maxDurationMs', 'Maximum').optional(),
    minCost: v2CostBoundSchema('minCost', 'Minimum').optional(),
    maxCost: v2CostBoundSchema('maxCost', 'Maximum').optional(),
    model: z.string().describe('AI model used during execution.').optional(),
    details: z
      .enum(['basic', 'full'])
      .describe(
        'Response detail level. `full` adds the `workflow` summary to every item. `includeTraceSpans=true` and `includeFinalOutput=true` each imply `full`, so either one adds `workflow` even when `details=basic` is sent explicitly.'
      )
      .optional()
      .default('basic'),
    includeTraceSpans: booleanQueryFlagSchema
      .describe(
        'Whether to include block-level trace spans. Implies `details=full`. Spans are pruned on their own retention schedule, so a run whose spans have aged out returns `traceSpans: []` rather than an error.'
      )
      .optional()
      .default(false),
    includeFinalOutput: booleanQueryFlagSchema
      .describe(
        'Whether to include the final workflow output. Implies `details=full`, so the `workflow` summary is present regardless of what `details` is set to.'
      )
      .optional()
      .default(false),
    ...v2PaginationFields({
      max: 1000,
      fallback: 100,
      outOfRange: 'clamp',
      description: 'Maximum log entries per page.',
    }),
    /**
     * Deliberate deviation from the v2 `sortBy` + `sortOrder` convention, and
     * the same one `GET /workflows/{id}/runs` makes for the same reason: logs
     * have exactly one sortable column (execution start time), so there is no
     * `sortBy` to pair with. `order` is the published name and renaming it
     * would break every caller, while accepting `sortOrder` as an alias would
     * add a second spelling of one thing with undefined precedence when both
     * arrive — so the split is documented rather than papered over.
     *
     * Shared with `GET /workflows/{id}/runs` so the two spell the enum the same
     * way in the generated specs.
     */
    order: v2RunOrderSchema('execution'),
    folderPaths: z
      .string()
      .describe(`Comma-separated workflow folder paths to include. ${V2_FOLDER_FILTER_MISS}`)
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
  /**
   * The other half of the parity with the sibling run list
   * (`v2ListWorkflowRunsQuerySchema`): agreeing on the timestamp *format* while
   * still disagreeing on window *validity* would leave an inverted window a 400 on
   * `/runs` and a silently empty page here — the same wrong-answer-instead-of-error
   * shape the format check was added to remove.
   */
  .refine(
    (query) =>
      !query.startDate ||
      !query.endDate ||
      Date.parse(query.startDate) <= Date.parse(query.endDate),
    {
      error: 'startDate must be before or equal to endDate',
      path: ['startDate'],
    }
  )
  /**
   * The cost and duration windows get the same treatment as the date window,
   * for the same reason: an inverted pair can never match a run, so answering
   * it with an empty page reports "those runs do not exist" for what is a
   * caller mistake.
   */
  .superRefine((query, ctx) => {
    if (
      query.minCost !== undefined &&
      query.maxCost !== undefined &&
      query.minCost > query.maxCost
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'minCost must be less than or equal to maxCost',
        path: ['minCost'],
      })
    }
    if (
      query.minDurationMs !== undefined &&
      query.maxDurationMs !== undefined &&
      query.minDurationMs > query.maxDurationMs
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'minDurationMs must be less than or equal to maxDurationMs',
        path: ['minDurationMs'],
      })
    }
  })

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
  query: noInputSchema,
  params: v2LogParamsSchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2LogDetailSchema),
  },
})
