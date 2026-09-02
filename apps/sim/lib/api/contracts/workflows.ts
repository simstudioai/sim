import {
  BLOCK_RETRY_MAX_TRIES,
  BLOCK_RETRY_MAX_WAIT_MS,
  BLOCK_RETRY_MIN_TRIES,
  BLOCK_RETRY_MIN_WAIT_MS,
} from '@sim/workflow-types/workflow'
import { z } from 'zod'
import {
  privateSecretProvenanceBundleSchema,
  requiredFieldSchema,
  workflowIdSchema,
  workspaceIdSchema,
} from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { MAX_WORKFLOW_EXECUTION_TIMEOUT_SECONDS } from '@/lib/billing/execution-timeout-defaults'
import { PRIVATE_SECRET_PROVENANCE_FIELD } from '@/lib/execution/private-tool-metadata'

const subBlockValuesSchema = z.record(z.string(), z.record(z.string(), z.unknown()))
export const WORKFLOW_EXECUTION_ID_HEADER = 'X-Execution-Id'
export const WORKFLOW_EXECUTION_TIMEOUT_SECONDS_HEADER = 'X-Execution-Timeout-Seconds'

export const executionIdSchema = z
  .string()
  .min(1, 'Invalid execution ID')
  .max(128, 'Execution ID too long')
  .regex(
    /^[A-Za-z0-9._:-]+$/,
    'Execution ID can only contain letters, numbers, dots, underscores, colons, and hyphens'
  )

const workflowPositionSchema = z.object({
  x: z.number(),
  y: z.number(),
})

const workflowBlockDataSchema = z.object({
  parentId: z.string().optional(),
  extent: z.literal('parent').optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  collection: z.unknown().optional(),
  count: z.number().optional(),
  loopType: z.enum(['for', 'forEach', 'while', 'doWhile']).optional(),
  whileCondition: z.string().optional(),
  doWhileCondition: z.string().optional(),
  parallelType: z.enum(['collection', 'count']).optional(),
  batchSize: z.number().optional(),
  type: z.string().optional(),
  canonicalModes: z.record(z.string(), z.enum(['basic', 'advanced'])).optional(),
})

const workflowSubBlockStateSchema = z.object({
  id: z.string(),
  type: z.string(),
  value: z.unknown(),
})

const workflowBlockOutputSchema = z.unknown()
const workflowEdgeHandleSchema = z
  .string()
  .nullish()
  .transform((value) => value ?? undefined)

const workflowBlockRetrySchema = z.object({
  enabled: z.boolean(),
  maxTries: z
    .number()
    .int()
    .min(BLOCK_RETRY_MIN_TRIES, `maxTries must be at least ${BLOCK_RETRY_MIN_TRIES}`)
    .max(BLOCK_RETRY_MAX_TRIES, `maxTries cannot exceed ${BLOCK_RETRY_MAX_TRIES}`),
  waitBetweenTriesMs: z
    .number()
    .int()
    .min(BLOCK_RETRY_MIN_WAIT_MS, 'waitBetweenTriesMs cannot be negative')
    .max(BLOCK_RETRY_MAX_WAIT_MS, `waitBetweenTriesMs cannot exceed ${BLOCK_RETRY_MAX_WAIT_MS}ms`),
})

const workflowBlockStateSchema = z.object({
  id: z.string(),
  type: z.string(),
  name: z.string(),
  position: workflowPositionSchema,
  subBlocks: z.record(z.string(), workflowSubBlockStateSchema),
  outputs: z.record(z.string(), workflowBlockOutputSchema),
  enabled: z.boolean(),
  horizontalHandles: z.boolean().optional(),
  height: z.number().optional(),
  advancedMode: z.boolean().optional(),
  errorEnabled: z.boolean().optional(),
  retry: workflowBlockRetrySchema.optional(),
  triggerMode: z.boolean().optional(),
  data: workflowBlockDataSchema.optional(),
  locked: z.boolean().optional(),
})

const workflowEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  sourceHandle: workflowEdgeHandleSchema,
  targetHandle: workflowEdgeHandleSchema,
  type: z.string().optional(),
  animated: z.boolean().optional(),
  style: z.record(z.string(), z.unknown()).optional(),
  data: z.record(z.string(), z.unknown()).optional(),
  label: z.string().optional(),
  labelStyle: z.record(z.string(), z.unknown()).optional(),
  labelShowBg: z.boolean().optional(),
  labelBgStyle: z.record(z.string(), z.unknown()).optional(),
  labelBgPadding: z.tuple([z.number(), z.number()]).optional(),
  labelBgBorderRadius: z.number().optional(),
  markerStart: z.string().optional(),
  markerEnd: z.string().optional(),
})

const workflowLoopSchema = z.object({
  id: z.string(),
  nodes: z.array(z.string()),
  iterations: z.number(),
  loopType: z.enum(['for', 'forEach', 'while', 'doWhile']),
  forEachItems: z
    .union([z.array(z.unknown()), z.record(z.string(), z.unknown()), z.string()])
    .optional(),
  whileCondition: z.string().optional(),
  doWhileCondition: z.string().optional(),
  enabled: z.boolean().optional(),
  locked: z.boolean().optional(),
})

const workflowParallelSchema = z.object({
  id: z.string(),
  nodes: z.array(z.string()),
  distribution: z
    .union([z.array(z.unknown()), z.record(z.string(), z.unknown()), z.string()])
    .optional(),
  count: z.number().optional(),
  parallelType: z.enum(['count', 'collection']).optional(),
  batchSize: z.number().optional(),
  enabled: z.boolean().optional(),
  locked: z.boolean().optional(),
})

/**
 * Write/input wire shape for a workflow variable.
 *
 * Intentionally omits `workflowId`: a variable is workflow-scoped and the
 * route's `[id]` path parameter is the single source of truth on writes.
 * Persisting `workflowId` per-variable would be redundant.
 *
 * `value` is `unknown` to match the canonical client-side `Variable` type
 * from `@sim/workflow-types/workflow`. Variables are free-form on the
 * editor (the user enters a string that may parse as any of the declared
 * types) and validation is done per-`type` at use-time by
 * `validateVariable` in `apps/sim/stores/variables/store.ts`.
 */
export const workflowVariableWriteSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(['string', 'number', 'boolean', 'object', 'array', 'plain']),
  value: z.unknown(),
  validationError: z.string().optional(),
})

/**
 * Read/response wire shape for a workflow variable.
 *
 * Adds the server-stamped `workflowId` that GET handlers attach for the
 * client-side variables store (`apps/sim/stores/variables/types.ts`),
 * which keeps a `workflowId` field for cross-workflow filtering inside a
 * single global store. Without this on the read schema, the field is
 * stripped during `requestJson` Zod parsing and the store filter breaks.
 *
 * Routes stamping this field:
 * - `apps/sim/app/api/workflows/[id]/route.ts` (GET) on `data.variables`
 * - `apps/sim/app/api/workflows/[id]/state/route.ts` (GET) on `variables`
 * - `apps/sim/app/api/workflows/[id]/variables/route.ts` (GET) on `data`
 */
export const workflowVariableReadSchema = workflowVariableWriteSchema.extend({
  workflowId: z.string(),
})

export const workflowStateSchema = z.object({
  blocks: z.record(z.string(), workflowBlockStateSchema),
  edges: z.array(workflowEdgeSchema),
  loops: z.record(z.string(), workflowLoopSchema).optional(),
  parallels: z.record(z.string(), workflowParallelSchema).optional(),
  lastSaved: z.number().optional(),
  isDeployed: z.boolean().optional(),
  deployedAt: z.coerce.date().nullable().optional(),
  variables: z.record(z.string(), workflowVariableWriteSchema).optional(),
  /**
   * Display metadata stamped onto the workflow state by the GET
   * `/api/workflows/[id]` route, so callers consuming the wire payload
   * (export, copilot tool result handling, etc.) can show the workflow's
   * name/description without a second request. Not persisted on disk —
   * the route reads it from the workflow row and stamps it on read.
   */
  metadata: z
    .object({
      name: z.string().optional(),
      description: z.string().nullable().optional(),
    })
    .optional(),
})

export type WorkflowStateContractInput = z.input<typeof workflowStateSchema>
export type WorkflowStateContractOutput = z.output<typeof workflowStateSchema>

export type WorkflowStateWirePayload = WorkflowStateContractOutput

/**
 * Loose subset of {@link workflowStateSchema} emitted by the copilot
 * checkpoint revert route. The route forwards the persisted JSONB blob
 * verbatim without strict schema validation, so `blocks`/`edges`/`loops`/
 * `parallels` are typed as opaque records/arrays here. Always carries
 * `lastSaved` (set by the route to `Date.now()`) and `isDeployed`; carries
 * `deployedAt` only when the persisted value is a valid date.
 */
export const cleanedWorkflowStateSchema = z.object({
  blocks: z.record(z.string(), z.unknown()),
  edges: z.array(z.unknown()),
  loops: z.record(z.string(), z.unknown()),
  parallels: z.record(z.string(), z.unknown()),
  isDeployed: z.boolean(),
  lastSaved: z.number(),
  deployedAt: z.coerce.date().optional(),
})

export type CleanedWorkflowState = z.output<typeof cleanedWorkflowStateSchema>

export const workflowScopeSchema = z.enum(['active', 'archived', 'all'])

export const workflowIdParamsSchema = z.object({
  id: z.string().min(1, 'Invalid workflow ID'),
})

export const workflowListQuerySchema = z.object({
  workspaceId: z.string().min(1).optional(),
  scope: workflowScopeSchema.default('active'),
})

export type WorkflowListItem = z.output<typeof workflowListItemSchema>

export const workflowListItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  workspaceId: z.string().nullable(),
  folderId: z.string().nullable(),
  sortOrder: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
  archivedAt: z.string().nullable(),
  locked: z.boolean(),
  /** Defaulted so a new client tolerates an old server's response during rollout. */
  forkSyncExcluded: z.boolean().default(false),
  isDeployed: z.boolean().optional(),
})

export const createWorkflowBodySchema = z.object({
  id: z.string().uuid().optional(),
  name: requiredFieldSchema('Name is required'),
  description: z.string().optional().default(''),
  workspaceId: z.string().optional(),
  folderId: z.string().nullable().optional(),
  sortOrder: z.number().int().optional(),
  deduplicate: z.boolean().optional(),
})

export const createWorkflowResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  workspaceId: z.string(),
  folderId: z.string().nullable().optional(),
  sortOrder: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
  startBlockId: z.string(),
  subBlockValues: subBlockValuesSchema,
})

export type CreateWorkflowBody = z.input<typeof createWorkflowBodySchema>
export type CreateWorkflowResponse = z.output<typeof createWorkflowResponseSchema>

export const duplicateWorkflowBodySchema = z.object({
  name: requiredFieldSchema('Name is required'),
  description: z.string().optional(),
  workspaceId: z.string().optional(),
  folderId: z.string().nullable().optional(),
  newId: z.string().uuid().optional(),
})

export const duplicateWorkflowResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  workspaceId: z.string(),
  folderId: z.string().nullable(),
  sortOrder: z.number(),
  locked: z.boolean(),
  blocksCount: z.number(),
  edgesCount: z.number(),
  subflowsCount: z.number(),
})

export type DuplicateWorkflowBody = z.input<typeof duplicateWorkflowBodySchema>
export type DuplicateWorkflowResponse = z.output<typeof duplicateWorkflowResponseSchema>

export const updateWorkflowBodySchema = z.object({
  name: requiredFieldSchema('Name is required').optional(),
  description: z.string().optional(),
  folderId: z.string().nullable().optional(),
  sortOrder: z.number().int().min(0).optional(),
  locked: z.boolean().optional(),
  forkSyncExcluded: z.boolean().optional(),
})

export type UpdateWorkflowBody = z.input<typeof updateWorkflowBodySchema>

export const reorderWorkflowsBodySchema = z.object({
  workspaceId: z.string(),
  updates: z.array(
    z.object({
      id: z.string(),
      sortOrder: z.number().int().min(0),
      folderId: z.string().nullable().optional(),
    })
  ),
})

export type ReorderWorkflowsBody = z.input<typeof reorderWorkflowsBodySchema>

export const executeWorkflowRunFromBlockSchema = z.object({
  startBlockId: requiredFieldSchema('Start block ID is required'),
  sourceSnapshot: z
    .object({
      blockStates: z.record(z.string(), z.any()),
      executedBlocks: z.array(z.string()),
      blockLogs: z.array(z.any()),
      decisions: z.object({
        router: z.record(z.string(), z.string()),
        condition: z.record(z.string(), z.string()),
      }),
      completedLoops: z.array(z.string()),
      loopExecutions: z.record(z.string(), z.any()).optional(),
      parallelExecutions: z.record(z.string(), z.any()).optional(),
      parallelBlockMapping: z.record(z.string(), z.any()).optional(),
      activeExecutionPath: z.array(z.string()),
    })
    .optional(),
  executionId: z.string().optional(),
})

export const executeWorkflowTriggerTypeSchema = z.enum([
  'manual',
  'api',
  'schedule',
  'chat',
  'webhook',
  'mcp',
  'copilot',
  'mothership',
  'workflow',
])

export const executeWorkflowHeadersSchema = z.object({
  [WORKFLOW_EXECUTION_ID_HEADER]: executionIdSchema.optional(),
  [WORKFLOW_EXECUTION_TIMEOUT_SECONDS_HEADER]: z.coerce
    .number()
    .int('Execution timeout must be a whole number of seconds')
    .positive('Execution timeout must be positive')
    .max(
      MAX_WORKFLOW_EXECUTION_TIMEOUT_SECONDS,
      `Execution timeout cannot exceed ${MAX_WORKFLOW_EXECUTION_TIMEOUT_SECONDS} seconds`
    )
    .optional(),
})

export const executeWorkflowBodySchema = z.object({
  [PRIVATE_SECRET_PROVENANCE_FIELD]: privateSecretProvenanceBundleSchema.optional(),
  selectedOutputs: z.array(z.string()).optional().default([]),
  triggerType: executeWorkflowTriggerTypeSchema.optional(),
  stream: z.boolean().optional(),
  /**
   * Streaming runs only: expose the agent's reasoning as `thinking` frames.
   * Requires the caller to also send the `agent-events-v1` protocol header.
   * Off by default so existing integrations keep their current frame set.
   */
  includeThinking: z.boolean().optional().default(false),
  /**
   * Streaming runs only: expose tool lifecycle as `tool` frames (name and
   * status only — arguments and results ride the terminal `final` envelope).
   * Requires the protocol header. Off by default.
   */
  includeToolCalls: z.boolean().optional().default(false),
  useDraftState: z.boolean().optional(),
  input: z.any().optional(),
  /** Trusted server-side reuse of a prior execution's raw workflow input. */
  inputFromExecutionId: executionIdSchema.optional(),
  isClientSession: z.boolean().optional(),
  includeFileBase64: z.boolean().optional().default(true),
  base64MaxBytes: z.number().int().positive().optional(),
  workflowStateOverride: workflowStateSchema.optional(),
  /** Internal MCP bridge pin for calls admitted before a deployment cutover. */
  deploymentVersionId: z.string().min(1).optional(),
  executionId: z.unknown().optional(),
  copilotToolCallId: z.string().min(1).max(255).optional(),
  triggerBlockId: z.string().optional(),
  startBlockId: z.string().optional(),
  stopAfterBlockId: z.string().optional(),
  runFromBlock: executeWorkflowRunFromBlockSchema.optional(),
  /**
   * Workspace of the parent execution when this call is a workflow-in-workflow
   * invocation (e.g. the agent `workflow_executor` tool). When present, the
   * route rejects execution of a workflow that lives in a different workspace.
   * Direct API callers omit it and are unaffected.
   */
  parentWorkspaceId: workspaceIdSchema.optional(),
})
export type ExecuteWorkflowBody = z.input<typeof executeWorkflowBodySchema>

export const workflowVariablesBodySchema = z.object({
  variables: z.record(z.string(), workflowVariableWriteSchema),
})
export type WorkflowVariablesBody = z.input<typeof workflowVariablesBodySchema>

export const workflowExecutionParamsSchema = z.object({
  id: z.string().min(1, 'Invalid workflow ID'),
  executionId: z.string().min(1, 'Invalid execution ID'),
})

export const resumeExecutionParamsSchema = z.object({
  workflowId: z.string().min(1),
  executionId: z.string().min(1),
})

export const resumeExecutionContextParamsSchema = z.object({
  workflowId: z.string().min(1),
  executionId: z.string().min(1),
  contextId: z.string().min(1),
})

export const workflowExecutionStreamQuerySchema = z.object({
  from: z.preprocess((value) => {
    if (typeof value !== 'string') return 0
    const parsed = Number.parseInt(value, 10)
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
  }, z.number().int().min(0)),
})

export const pausedWorkflowExecutionsQuerySchema = z.object({
  status: z.string().optional(),
})

export const workflowAutoLayoutBodySchema = z.object({
  spacing: z
    .object({
      horizontal: z.number().min(100).max(1000).optional(),
      vertical: z.number().min(50).max(500).optional(),
    })
    .optional()
    .default({}),
  alignment: z.enum(['start', 'center', 'end']).optional().default('center'),
  padding: z
    .object({
      x: z.number().min(50).max(500).optional(),
      y: z.number().min(50).max(500).optional(),
    })
    .optional()
    .default({}),
  gridSize: z.number().min(0).max(50).optional(),
  blocks: z.record(z.string(), z.any()).optional(),
  edges: z.array(z.any()).optional(),
  loops: z.record(z.string(), z.any()).optional(),
  parallels: z.record(z.string(), z.any()).optional(),
})
export type WorkflowAutoLayoutBody = z.input<typeof workflowAutoLayoutBodySchema>

export const workflowDeploymentVersionParamSchema = z.union([
  z.literal('active'),
  z.coerce.number().refine(Number.isFinite, 'Invalid version'),
])
export type WorkflowDeploymentVersionParam = z.output<typeof workflowDeploymentVersionParamSchema>

export const workflowLogResultSchema = z.object({
  success: z.boolean(),
  error: z.string().optional(),
  output: z.any(),
  metadata: z
    .object({
      source: z.string().optional(),
      duration: z.number().optional(),
    })
    .optional(),
})

export const workflowLogBodySchema = z.object({
  logs: z.array(z.any()).optional(),
  executionId: requiredFieldSchema('Execution ID is required').optional(),
  result: workflowLogResultSchema.optional(),
})
export type WorkflowLogBody = z.input<typeof workflowLogBodySchema>

export const importWorkflowAsSuperuserBodySchema = z.object({
  workflowId: workflowIdSchema,
  targetWorkspaceId: requiredFieldSchema('Target workspace ID is required'),
})

export type ImportWorkflowAsSuperuserBody = z.input<typeof importWorkflowAsSuperuserBodySchema>

export const importWorkflowAsSuperuserResponseSchema = z.object({
  success: z.literal(true),
  newWorkflowId: z.string(),
  copilotChatsImported: z.number(),
})

export type ImportWorkflowAsSuperuserResponse = z.output<
  typeof importWorkflowAsSuperuserResponseSchema
>

const successResponseSchema = z.object({
  success: z.literal(true),
})

const workflowStatusResponseSchema = z.object({
  isDeployed: z.boolean(),
  deployedAt: z.coerce.date().nullable().optional(),
  isPublished: z.boolean().optional(),
  needsRedeployment: z.boolean(),
})

const workflowAutoLayoutResponseSchema = z.object({
  success: z.literal(true),
  message: z.string(),
  data: z.object({
    blockCount: z.number(),
    elapsed: z.string(),
    layoutedBlocks: z.record(z.string(), workflowBlockStateSchema),
  }),
})

const workflowLogResponseSchema = z.object({
  message: z.string(),
})

const workflowVariablesResponseSchema = z.object({
  success: z.literal(true),
})

const pausedWorkflowExecutionSummarySchema = z
  .object({
    id: z.string(),
    workflowId: z.string(),
    executionId: z.string(),
    status: z.string(),
    totalPauseCount: z.number(),
    resumedCount: z.number(),
    pausedAt: z.string().nullable(),
    updatedAt: z.string().nullable(),
    expiresAt: z.string().nullable(),
    metadata: z.record(z.string(), z.unknown()).nullable(),
    triggerIds: z.array(z.string()),
    pausePoints: z.array(z.record(z.string(), z.unknown())),
  })
  .passthrough()

const pausedWorkflowExecutionsResponseSchema = z.object({
  pausedExecutions: z.array(pausedWorkflowExecutionSummarySchema),
})

const pausedWorkflowExecutionDetailSchema = pausedWorkflowExecutionSummarySchema.extend({
  executionSnapshot: z.unknown(),
  queue: z.array(z.record(z.string(), z.unknown())),
})

const workflowExecutionStatusEnum = z.enum([
  'queued',
  'pending',
  'running',
  'paused',
  'completed',
  'failed',
  'cancelled',
])

export const workflowExecutionPausedDetailSchema = z.object({
  contextId: z
    .string()
    .nullable()
    .describe('Resume context identifier, or null while every pause point is mid-resume.'),
  pausedAt: z
    .string()
    .datetime()
    .meta({ format: 'date-time' })
    .describe('ISO 8601 timestamp when the execution entered the paused state.'),
  resumeAt: z
    .string()
    .datetime()
    .meta({ format: 'date-time' })
    .nullable()
    .describe('ISO 8601 scheduled automatic-resume timestamp, or null when no resume time is set.'),
  pauseKind: z
    .enum(['time', 'human'])
    .nullable()
    .describe('Whether the pause waits for time or human input, or null when unspecified.'),
  blockedOnBlockId: z
    .string()
    .nullable()
    .describe('Workflow block awaiting resume, or null when no block is identified.'),
  automaticResumeWaitingReason: z
    .string()
    .nullable()
    .describe(
      'Why automatic resume is waiting, or null when it is not — on a paused run, null means it is waiting on human input. Recorded whenever a resume attempt fails and cleared once one succeeds. A non-retryable or exhausted failure is prefixed `Automatic resume requires manual intervention: `.'
    ),
  pausedExecutionId: z.string().describe('Persistent paused-execution record identifier.'),
  pausePointCount: z.number().describe('Number of pause points tracked for the execution.'),
  resumedCount: z.number().describe('Number of pause points that have resumed.'),
})

const workflowExecutionStatusResponseSchema = z.object({
  executionId: z.string(),
  workflowId: z.string(),
  status: workflowExecutionStatusEnum,
  trigger: z.string(),
  level: z.string(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  totalDurationMs: z.number().nullable(),
  paused: workflowExecutionPausedDetailSchema.nullable(),
  cost: z.object({ total: z.number() }).nullable(),
  error: z.string().nullable(),
  finalOutput: z.unknown().nullable(),
  blockOutputs: z.record(z.string(), z.unknown()).nullable(),
})

export type WorkflowExecutionStatusResponse = z.output<typeof workflowExecutionStatusResponseSchema>

export const workflowExecutionStatusQuerySchema = z.object({
  includeOutput: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
  selectedOutputs: z
    .string()
    .optional()
    .transform((value) =>
      value
        ? value
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : []
    ),
})

/** Mirrors the surface-neutral cancellation service's complete outcome vocabulary. */
export const cancelWorkflowExecutionReasonSchema = z.enum([
  'recorded',
  'already_cancelled',
  'already_completed',
  'already_failed',
  'redis_unavailable',
  'redis_write_failed',
  'paused_event_publish_failed',
  'paused_database_cancel_failed',
  'queue_cancelled',
  'active_resume_signal_failed',
  'cancellation_not_finalized',
])

const cancelWorkflowExecutionResponseSchema = z.object({
  success: z.boolean(),
  executionId: z.string(),
  redisAvailable: z.boolean(),
  durablyRecorded: z.boolean(),
  locallyAborted: z.boolean(),
  pausedCancelled: z.boolean(),
  reason: cancelWorkflowExecutionReasonSchema.optional(),
})

export type CancelWorkflowExecutionResponse = z.output<typeof cancelWorkflowExecutionResponseSchema>

const resumeWorkflowExecutionContextResponseSchema = z
  .object({
    status: z.enum(['queued', 'started']).optional(),
    success: z.boolean().optional(),
    async: z.boolean().optional(),
    executionId: z.string().optional(),
    queuePosition: z.number().optional(),
    jobId: z.string().optional(),
    output: z.unknown().optional(),
    error: z.string().optional(),
    metadata: z
      .object({
        duration: z.number().optional(),
        startTime: z.string().optional(),
        endTime: z.string().optional(),
      })
      .optional(),
    message: z.string().optional(),
    statusUrl: z.string().optional(),
  })
  .passthrough()

export const listWorkflowsContract = defineRouteContract({
  method: 'GET',
  path: '/api/workflows',
  query: workflowListQuerySchema,
  response: {
    mode: 'json',
    schema: z.object({
      data: z.array(workflowListItemSchema),
    }),
  },
})

/**
 * Wire shape returned by GET `/api/workflows/[id]` for the `data` payload.
 * Mirrors the workflow row spread by the route handler plus the stamped `state`
 * (built from normalized tables) and stamped per-variable `workflowId`. Keep
 * this aligned with `apps/sim/app/api/workflows/[id]/route.ts` whenever the
 * row spread or the state assembly changes — it replaces a previous
 * `.passthrough()` slot that forced clients to cast row fields like
 * `workspaceId` / `isDeployed` / `deployedAt` out as `unknown`.
 */
export const getWorkflowResponseDataSchema = z.object({
  id: z.string(),
  userId: z.string(),
  workspaceId: z.string().nullable(),
  folderId: z.string().nullable(),
  sortOrder: z.number(),
  name: z.string(),
  description: z.string().nullable(),
  lastSynced: z.coerce.date(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  isDeployed: z.boolean(),
  deployedAt: z.coerce.date().nullable(),
  isPublicApi: z.boolean(),
  locked: z.boolean(),
  forkSyncExcluded: z.boolean().default(false),
  runCount: z.number(),
  lastRunAt: z.coerce.date().nullable(),
  archivedAt: z.coerce.date().nullable(),
  state: workflowStateSchema,
  variables: z.record(z.string(), workflowVariableReadSchema).optional(),
})

export type GetWorkflowResponseData = z.output<typeof getWorkflowResponseDataSchema>

export const getWorkflowStateContract = defineRouteContract({
  method: 'GET',
  path: '/api/workflows/[id]',
  params: workflowIdParamsSchema,
  response: {
    mode: 'json',
    schema: z.object({
      data: getWorkflowResponseDataSchema,
    }),
  },
})

export const workflowStateResponseSchema = z.object({
  blocks: z.record(z.string(), workflowBlockStateSchema),
  edges: z.array(workflowEdgeSchema),
  loops: z.record(z.string(), workflowLoopSchema),
  parallels: z.record(z.string(), workflowParallelSchema),
  variables: z.record(z.string(), workflowVariableReadSchema),
})

export const getWorkflowNormalizedStateContract = defineRouteContract({
  method: 'GET',
  path: '/api/workflows/[id]/state',
  params: workflowIdParamsSchema,
  response: {
    mode: 'json',
    schema: workflowStateResponseSchema,
  },
})

export const putWorkflowNormalizedStateContract = defineRouteContract({
  method: 'PUT',
  path: '/api/workflows/[id]/state',
  params: workflowIdParamsSchema,
  body: workflowStateSchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
      warnings: z.array(z.string()).default([]),
    }),
  },
})

export const createWorkflowContract = defineRouteContract({
  method: 'POST',
  path: '/api/workflows',
  body: createWorkflowBodySchema,
  response: {
    mode: 'json',
    schema: createWorkflowResponseSchema,
  },
})

export const duplicateWorkflowContract = defineRouteContract({
  method: 'POST',
  path: '/api/workflows/[id]/duplicate',
  params: workflowIdParamsSchema,
  body: duplicateWorkflowBodySchema,
  response: {
    mode: 'json',
    schema: duplicateWorkflowResponseSchema,
  },
})

export const updateWorkflowContract = defineRouteContract({
  method: 'PUT',
  path: '/api/workflows/[id]',
  params: workflowIdParamsSchema,
  body: updateWorkflowBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      workflow: workflowListItemSchema,
    }),
  },
})

export const deleteWorkflowContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/workflows/[id]',
  params: workflowIdParamsSchema,
  response: {
    mode: 'json',
    schema: successResponseSchema,
  },
})

export const reorderWorkflowsContract = defineRouteContract({
  method: 'PUT',
  path: '/api/workflows/reorder',
  body: reorderWorkflowsBodySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema.extend({
      updated: z.number(),
    }),
  },
})

export const restoreWorkflowContract = defineRouteContract({
  method: 'POST',
  path: '/api/workflows/[id]/restore',
  params: workflowIdParamsSchema,
  response: {
    mode: 'json',
    schema: successResponseSchema,
  },
})

export const importWorkflowAsSuperuserContract = defineRouteContract({
  method: 'POST',
  path: '/api/superuser/import-workflow',
  body: importWorkflowAsSuperuserBodySchema,
  response: {
    mode: 'json',
    schema: importWorkflowAsSuperuserResponseSchema,
  },
})

export const getWorkflowStatusContract = defineRouteContract({
  method: 'GET',
  path: '/api/workflows/[id]/status',
  params: workflowIdParamsSchema,
  response: {
    mode: 'json',
    schema: workflowStatusResponseSchema,
  },
})

export const workflowAutoLayoutContract = defineRouteContract({
  method: 'POST',
  path: '/api/workflows/[id]/autolayout',
  params: workflowIdParamsSchema,
  body: workflowAutoLayoutBodySchema,
  response: {
    mode: 'json',
    schema: workflowAutoLayoutResponseSchema,
  },
})

export const workflowLogContract = defineRouteContract({
  method: 'POST',
  path: '/api/workflows/[id]/log',
  params: workflowIdParamsSchema,
  body: workflowLogBodySchema,
  response: {
    mode: 'json',
    schema: workflowLogResponseSchema,
  },
})

export const workflowVariablesContract = defineRouteContract({
  method: 'POST',
  path: '/api/workflows/[id]/variables',
  params: workflowIdParamsSchema,
  body: workflowVariablesBodySchema,
  response: {
    mode: 'json',
    schema: workflowVariablesResponseSchema,
  },
})

export const getWorkflowVariablesContract = defineRouteContract({
  method: 'GET',
  path: '/api/workflows/[id]/variables',
  params: workflowIdParamsSchema,
  response: {
    mode: 'json',
    schema: z.object({
      data: z.record(z.string(), workflowVariableReadSchema),
    }),
  },
})

export const pausedWorkflowExecutionsContract = defineRouteContract({
  method: 'GET',
  path: '/api/workflows/[id]/paused',
  params: workflowIdParamsSchema,
  query: pausedWorkflowExecutionsQuerySchema,
  response: {
    mode: 'json',
    schema: pausedWorkflowExecutionsResponseSchema,
  },
})

export const pausedWorkflowExecutionByIdContract = defineRouteContract({
  method: 'GET',
  path: '/api/workflows/[id]/paused/[executionId]',
  params: workflowExecutionParamsSchema,
  response: {
    mode: 'json',
    schema: pausedWorkflowExecutionDetailSchema,
  },
})

export const cancelWorkflowExecutionContract = defineRouteContract({
  method: 'POST',
  path: '/api/workflows/[id]/executions/[executionId]/cancel',
  params: workflowExecutionParamsSchema,
  response: {
    mode: 'json',
    schema: cancelWorkflowExecutionResponseSchema,
  },
})

export const getWorkflowExecutionContract = defineRouteContract({
  method: 'GET',
  path: '/api/workflows/[id]/executions/[executionId]',
  params: workflowExecutionParamsSchema,
  query: workflowExecutionStatusQuerySchema,
  response: {
    mode: 'json',
    schema: workflowExecutionStatusResponseSchema,
  },
})

export const streamWorkflowExecutionContract = defineRouteContract({
  method: 'GET',
  path: '/api/workflows/[id]/executions/[executionId]/stream',
  params: workflowExecutionParamsSchema,
  query: workflowExecutionStreamQuerySchema,
  response: {
    mode: 'stream',
  },
})

export const resumeWorkflowExecutionContract = defineRouteContract({
  method: 'GET',
  path: '/api/resume/[workflowId]/[executionId]',
  params: resumeExecutionParamsSchema,
  response: {
    mode: 'json',
    schema: pausedWorkflowExecutionDetailSchema,
  },
})

export const resumeWorkflowExecutionContextContract = defineRouteContract({
  method: 'POST',
  path: '/api/resume/[workflowId]/[executionId]/[contextId]',
  params: resumeExecutionContextParamsSchema,
  response: {
    mode: 'json',
    schema: resumeWorkflowExecutionContextResponseSchema,
  },
})

/**
 * Detail for a single pause context. The `pausePoint`/`queue`/`activeResumeEntry`
 * shapes are modeled loosely (the pause point's `response.data` is block- and
 * user-defined) — consistent with how the parent execution detail contract
 * (`pausedWorkflowExecutionDetailSchema`) keeps its pause points as records.
 */
const pauseContextDetailResponseSchema = z
  .object({
    execution: pausedWorkflowExecutionSummarySchema,
    pausePoint: z.record(z.string(), z.unknown()),
    queue: z.array(z.record(z.string(), z.unknown())),
    activeResumeEntry: z.record(z.string(), z.unknown()).nullable().optional(),
  })
  .passthrough()

export const getPauseContextDetailContract = defineRouteContract({
  method: 'GET',
  path: '/api/resume/[workflowId]/[executionId]/[contextId]',
  params: resumeExecutionContextParamsSchema,
  response: {
    mode: 'json',
    schema: pauseContextDetailResponseSchema,
  },
})
