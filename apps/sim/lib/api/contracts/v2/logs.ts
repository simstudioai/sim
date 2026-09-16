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
  V2_SEARCH_MAX_LENGTH,
  v2CursorListResponse,
  v2DataResponse,
  v2FolderPathInputSchema,
  v2FolderPathSchema,
  v2PaginationFields,
  v2RunWindowBoundSchema,
  v2SortFields,
  v2TimestampSchema,
} from '@/lib/api/contracts/v2/shared'
import { v2RunFileSchema } from '@/lib/api/contracts/v2/workflows'
import { PERSISTED_WORKFLOW_EXECUTION_STATUSES } from '@/lib/logs/types'

/**
 * v2 logs contracts. The query schemas are reused verbatim from v1 (the request
 * shape is unchanged); only the response envelope is upgraded to the canonical
 * v2 shapes with concrete item schemas.
 */

const v2LogCostSchema = z
  .object({ total: z.number().describe('Total execution cost in USD.') })
  .nullable()
  .describe(
    'Cost charged for the run, or null when the run has neither a recorded total nor an itemized ledger.'
  )

const v2CostLedgerItemSchema = z
  .object({
    category: z
      .enum(['fixed', 'model', 'tool'])
      .describe(
        "What the line is for: the run's base fee (`fixed`), one model's inference (`model`), or one metered tool or integration call (`tool`)."
      ),
    description: z
      .string()
      .describe('Human-readable name of the billed item, such as the model or tool id.'),
    cost: z.number().describe('Amount billed for this line, in USD.'),
    inputTokens: z
      .number()
      .optional()
      .describe('Input tokens attributed to this line. Absent for lines that do not bill tokens.'),
    outputTokens: z
      .number()
      .optional()
      .describe('Output tokens attributed to this line. Absent for lines that do not bill tokens.'),
  })
  .describe('One billed line of a run, folded across every event that billed it.')

/**
 * The run's cost, itemized.
 *
 * `items: null` and `items: []` are different answers and both are reachable, so
 * a caller must not read one as the other. `null` means no ledger exists for the
 * run — it predates the ledger, or it is a job run, whose costs are not recorded
 * under the workflow source the ledger reads. An empty array would claim a
 * ledger that itemizes to nothing.
 */
const v2LogDetailCostSchema = z
  .object({
    total: z.number().describe('Total execution cost in USD.'),
    items: z
      .array(v2CostLedgerItemSchema)
      .nullable()
      .describe(
        'Billed lines reconciling to `total`, or null when no itemized ledger exists for the run.'
      ),
  })
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

/**
 * One file a run produced, as the log surface publishes it.
 *
 * Exactly the run resource's own file projection minus `base64` — this read
 * never inlines bytes — rather than a parallel shape, because the two describe
 * the same objects and a caller addresses them through the same
 * `downloadPath`. Reusing it also carries the reason the storage `key` is
 * absent: a caller names a file by `id`, the key is re-derived server side from
 * the run's recording on every request, and publishing it would let a request
 * name bytes the run did not produce.
 */
const v2LogFileSchema = v2RunFileSchema.omit({ base64: true }).meta({
  id: 'V2LogFile',
  title: 'Execution log file',
  description: 'A file produced by the run this log records.',
})

/**
 * Files the run produced.
 *
 * Projected from `workflow_execution_logs.files` rather than passed through.
 * That column is a recording, not a manifest: the start block copies every
 * caller-supplied input field verbatim into its output, so the blob carries
 * input attachments and can carry a `UserFile` naming any storage key at all.
 * Only entries whose key sits under this run's own
 * `execution/<workspaceId>/<workflowId>/<executionId>/…` prefix survive
 * (`isRunOutputFileKey`), so a recorded entry that names another run's — or
 * another tenant's — bytes is dropped rather than published.
 *
 * `null` and `[]` mean different things and both are reachable: `null` is a run
 * that recorded no files at all, `[]` a run whose recorded entries were all
 * input files or otherwise outside its own output scope.
 */
const v2LogFilesSchema = z
  .array(v2LogFileSchema)
  .nullable()
  .describe(
    "Files the run produced, or null when none are recorded. Only the run's own output files appear; input attachments a caller supplied are addressed through the files API instead."
  )

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
    'Workflow graph captured for the run, or null if unavailable. Sensitive values are redacted to null; environment-variable references may be preserved.'
  )

const v2LogWorkflowSummarySchema = z.object({
  id: z.string().nullable().describe('Workflow identifier, or null when unavailable.'),
  name: z.string().describe('Workflow name.'),
  description: z.string().nullable().describe('Workflow description, or null when unset.'),
  deleted: z.boolean().describe('Whether the workflow has been deleted.'),
})

export const v2LogListItemSchema = z
  .object({
    /**
     * Which sequence the row came from.
     *
     * Load-bearing rather than decorative: a job run and a workflow run whose
     * workflow was deleted both report `workflowId: null`, so without this a
     * caller cannot tell "this run never had a workflow" from "its workflow is
     * gone" — two different answers to the same field.
     */
    kind: z
      .enum(['workflow', 'job'])
      .describe(
        'Whether the run executed a workflow or a Chat / Sim-agent job. Job runs appear only when `includeJobRuns=true`.'
      ),
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
    /**
     * The identity the run acted as, captured by the run itself rather than read
     * from the workflow row. Supersedes the deprecated `workflow.ownerEmail`,
     * which named whoever the workflow currently belongs to — a mutable pointer
     * that member removal reassigns, so it could describe someone who had nothing
     * to do with a run that happened months earlier and contributed nothing to it
     * beyond a personal-variable fallback.
     */
    executedByEmail: z
      .email()
      .nullable()
      .describe(
        'Email of the identity the run executed as: the caller for an interactive or personal-API-key run, and the workspace billing account for a schedule, webhook, deployed chat, or public API call. Null when the run failed before an identity was resolved.'
      ),
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
        /**
         * Retained only because it was a required field of this schema before
         * `executedByEmail` replaced it, and removing it would break typed
         * clients. It answers a different question than most readers assume: who
         * the workflow belongs to now, which member removal reassigns and which
         * says nothing about who ran any particular execution.
         */
        ownerEmail: z
          .email()
          .nullable()
          .describe(
            "Deprecated — use the run-level `executedByEmail` instead. Email of the workflow's current owner, or null when unavailable. This is a property of the workflow as it stands today, not of the run: it changes when workflow ownership is reassigned, and the owner is not the identity a background run executes as."
          )
          .meta({ deprecated: true }),
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
    /**
     * Both `.describe()` calls survive and both are required: the inner one
     * documents the `unknown` branch of the nullable union, which the OpenAPI
     * generator refuses to emit undescribed, and the outer one documents the
     * union itself. Collapsing them to one fails `generate:openapi`.
     */
    finalOutput: z
      .unknown()
      .describe('Materialized final workflow output value.')
      .nullable()
      .describe('Materialized final workflow output, or null when none was produced.'),
    cost: v2LogDetailCostSchema,
    // untyped-response: workflow input is the caller-supplied trigger payload, which has no server-side schema
    /** Doubly described for the reason `finalOutput` above is. */
    workflowInput: z
      .unknown()
      .describe('Caller-supplied trigger payload for the run.')
      .nullable()
      .describe(
        'Input the run was triggered with, or null when the run recorded none. Credential-bearing and PII-masked values are redacted the same way `finalOutput` is.'
      ),
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
function v2CommaListSchema(field: 'workflowIds' | 'triggers', description: string, max: number) {
  return z
    .string()
    .describe(`${description} At most ${max} entries.`)
    .refine((value) => value.split(',').every((entry) => entry.length > 0), {
      error: `${field} must not contain an empty entry`,
    })
    .refine((value) => value.split(',').length <= max, {
      error: `${field} cannot contain more than ${max} entries`,
    })
}

/**
 * Ceilings on the comma-separated filter lists.
 *
 * An id list compiles to `IN (...)`, so an unbounded one is an unbounded query
 * string, an unbounded bind-parameter list, and a plan whose cost the caller
 * rather than the server chooses.
 *
 * The numbers came from a JSON-body variant of this read that existed only
 * inside the change that added them and never reached the wire, so do not go
 * looking for a shipped endpoint that enforced them — these ceilings are this
 * list's own, and `GET /logs/stats` reuses them so the two filter dialects over
 * the same rows cannot drift.
 */
export const V2_LOG_WORKFLOW_IDS_MAX = 200
export const V2_LOG_FOLDER_PATHS_MAX = 100
export const V2_LOG_TRIGGERS_MAX = 100

/**
 * The `status` filter: a comma-separated list of persisted execution statuses.
 *
 * Matched against exactly the column the responses report, rather than being
 * derived from `level` + `ended_at` the way the first-party list's
 * `running`/`pending` pseudo-levels are. A filter that selected on a different
 * rule than the field it names would hand back rows whose reported `status` is
 * not the one asked for — a wrong answer rather than a missing feature. `level`
 * stays accepted and orthogonal: it is severity, this is lifecycle, and the two
 * are ANDed.
 */
const v2LogStatusFilterSchema = z
  .string()
  .describe(
    `Comma-separated execution statuses to include, from ${PERSISTED_WORKFLOW_EXECUTION_STATUSES.map((status) => `\`${status}\``).join(' | ')}. An empty entry is rejected. ANDed with \`level\`, which reports severity rather than lifecycle.`
  )
  .refine((value) => value.split(',').every((entry) => entry.length > 0), {
    error: 'status must not contain an empty entry',
  })
  .refine((value) => value.split(',').length <= PERSISTED_WORKFLOW_EXECUTION_STATUSES.length, {
    error: `status cannot contain more than ${PERSISTED_WORKFLOW_EXECUTION_STATUSES.length} entries`,
  })
  .refine(
    (value) =>
      value
        .split(',')
        .every((entry) =>
          (PERSISTED_WORKFLOW_EXECUTION_STATUSES as readonly string[]).includes(entry)
        ),
    {
      error: `status: expected one or more of ${PERSISTED_WORKFLOW_EXECUTION_STATUSES.map((status) => `"${status}"`).join(' | ')}`,
    }
  )

/**
 * The `workflowName` filter: a bounded, case-insensitive substring of the run's
 * workflow name.
 *
 * Bounded for the reason every v2 `search` term is — it compiles to an unindexed
 * `ILIKE` — and spelled `workflowName` rather than `search` because that is what
 * it matches. The first-party `search` param matches an execution-id substring,
 * which is not a search anyone would ask for over opaque identifiers and which
 * `runId` already answers exactly, so it is deliberately not published here.
 */
const v2WorkflowNameFilterSchema = z
  .string()
  .trim()
  .min(1, 'workflowName cannot be empty')
  .max(V2_SEARCH_MAX_LENGTH, 'workflowName is too long')
  .describe(
    "Case-insensitive substring match against the run's workflow name. Runs whose workflow has been deleted match nothing, because the name is no longer joinable."
  )

/**
 * The columns `GET /api/v2/logs` can order by.
 *
 * Kept in step with `PUBLIC_LOG_SORT_FIELDS` in `lib/logs/public-queries.ts`,
 * which turns each of these into a keyset; a member here with no keyset there
 * is a sort the read cannot express.
 */
const v2LogSortFields = ['startedAt', 'durationMs', 'cost', 'status'] as const

/** The shared `sortBy` + `sortOrder` pair, at this resource's defaults. */
const v2LogSortFieldSchemas = v2SortFields(v2LogSortFields, {
  sortBy: 'startedAt',
  sortOrder: 'desc',
})

export const v2ListLogsQuerySchema = v1ListLogsQuerySchema
  /**
   * `order` is dropped in favour of the surface-wide `sortBy` + `sortOrder`
   * pair. v2 logs now sort by four columns, so a lone direction param cannot
   * express the ordering, and carrying both would be two spellings of one thing
   * with undefined precedence when both arrive.
   */
  .omit({ executionId: true, folderIds: true, order: true })
  .extend({
    workspaceId: workspaceIdSchema.describe('Workspace whose execution logs should be returned.'),
    workflowIds: v2CommaListSchema(
      'workflowIds',
      'Comma-separated workflow identifiers to include. An empty entry is rejected.',
      V2_LOG_WORKFLOW_IDS_MAX
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
      'Comma-separated, lowercase trigger types or webhook provider IDs. Matching is exact and case-sensitive; unknown values select no runs. An empty entry is rejected. The sentinel `all` disables this filter, even when listed with other values.',
      V2_LOG_TRIGGERS_MAX
    ).optional(),
    level: z.enum(['info', 'error']).describe('Severity level to include.').optional(),
    status: v2LogStatusFilterSchema.optional(),
    workflowName: v2WorkflowNameFilterSchema.optional(),
    includeJobRuns: booleanQueryFlagSchema
      .describe(
        'Include Chat and Sim-agent jobs alongside workflow runs. Jobs use `kind: "job"` and have no workflow or cost ledger. Workflow, folder, model, or status filters exclude jobs. This option is valid only when sorting by `startedAt`.'
      )
      .optional()
      .default(false),
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
        'Response detail level. `full` adds the `workflow` summary to every workflow run; a job run never carries one, whatever this is set to. `includeTraceSpans=true` and `includeFinalOutput=true` each imply `full`, so either one adds `workflow` even when `details=basic` is sent explicitly.'
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
    ...v2LogSortFieldSchemas,
    /**
     * Re-described rather than re-declared: the pair itself comes from the
     * shared {@link v2SortFields} helper, and only the null-ordering caveat is
     * local to this resource.
     */
    sortBy: v2LogSortFieldSchemas.sortBy.describe(
      'Field used to sort the result. `durationMs` and `cost` are null until a run settles; those runs sort before recorded values in ascending order and after them in descending order. Only `startedAt` can order Chat and Sim-agent job runs, so any other value is rejected when job runs are included.'
    ),
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
    /**
     * `job_execution_logs` stores cost as a jsonb document and records no
     * comparable persisted status, so ordering the two tables together on
     * `durationMs`, `cost`, or `status` would compare values that do not mean
     * the same thing. Silently dropping the job branch would answer a request
     * the caller made with a sequence it did not ask for, so the combination is
     * refused and the message names the way out.
     */
    if (query.includeJobRuns && query.sortBy !== 'startedAt') {
      ctx.addIssue({
        code: 'custom',
        message: `sortBy: only "startedAt" can order job runs; drop includeJobRuns or sort by "startedAt"`,
        path: ['sortBy'],
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
