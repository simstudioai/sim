import { z } from 'zod'
import {
  deployedWorkflowStateSchema,
  deploymentVersionParamsSchema,
  deploymentVersionSchema,
} from '@/lib/api/contracts/deployments'
import { booleanQueryFlagSchema, workspaceIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import {
  V1_IMPORT_DESCRIPTION_MAX_LENGTH,
  V1_IMPORT_NAME_MAX_LENGTH,
  v1DeployWorkflowDataSchema,
  v1ImportWorkflowBodySchema,
  v1RollbackWorkflowDataSchema,
  v1WorkflowExportPayloadSchema,
} from '@/lib/api/contracts/v1/workflows'
import {
  v2CreateFolderBodySchema,
  v2CursorListResponse,
  v2DataResponse,
  v2DeleteFolderQuerySchema,
  v2FolderPathInputSchema,
  v2FolderPathSchema,
  v2FolderSchema,
  v2ListFoldersQuerySchema,
  v2RelocateFolderBodySchema,
  v2SearchSchema,
  v2SortFields,
} from '@/lib/api/contracts/v2/shared'
import {
  cancelWorkflowExecutionReasonSchema,
  workflowExecutionParamsSchema,
  workflowExecutionPausedDetailSchema,
  workflowExecutionStatusQuerySchema,
  workflowIdParamsSchema,
} from '@/lib/api/contracts/workflows'

/**
 * v2 workflows contracts. Request shapes are reused from v1 (the `[id]` param
 * is unchanged, and the list query extends v1's with the v2 search/sort
 * convention); only the response envelope is upgraded to the canonical v2
 * shapes with concrete item/detail schemas. The deploy/rollback/undeploy data
 * payloads reuse the already-concrete v1 schemas, re-wrapped in
 * `v2DataResponse` (the v1 `limits` body field is dropped — v2 carries
 * rate-limit state in headers and usage on a dedicated endpoint).
 *
 * The create/update bodies have no v1 counterpart and are v2-native: they carry
 * only the fields a public caller owns (name, description, folder placement).
 * `sortOrder`, `locked`, and `forkSyncExcluded` are workspace-UI concerns and
 * are not part of the public surface.
 */

/**
 * Sortable workflow fields. `position` is the workspace's manual arrangement
 * (the `sort_order` column the sidebar writes), kept as the default so a bare
 * list still returns workflows in the order the workspace put them in.
 */
export const v2WorkflowSortFields = [
  'position',
  'name',
  'createdAt',
  'updatedAt',
  'runCount',
] as const

export type V2WorkflowSortBy = (typeof v2WorkflowSortFields)[number]

/**
 * List query: v1's workspace/folder/deployment filters plus the v2 search and
 * sort convention. The keyset behind the cursor follows `sortBy`, so the cursor
 * carries the sort it was minted under and is rejected once that changes.
 */
export const v2ListWorkflowsQuerySchema = z
  .object({
    workspaceId: workspaceIdSchema,
    folderPath: v2FolderPathInputSchema.optional(),
    deployedOnly: booleanQueryFlagSchema.optional().default(false),
    limit: z.coerce.number().min(1).max(100).optional().default(50),
    cursor: z.string().optional(),
    search: v2SearchSchema,
    ...v2SortFields(v2WorkflowSortFields, { sortBy: 'position', sortOrder: 'asc' }),
  })
  .strict()

export type V2ListWorkflowsQuery = z.output<typeof v2ListWorkflowsQuerySchema>

export const v2WorkflowListItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  folderPath: v2FolderPathSchema,
  workspaceId: z.string(),
  isDeployed: z.boolean(),
  deployedAt: z.string().nullable(),
  runCount: z.number(),
  lastRunAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type V2WorkflowListItem = z.output<typeof v2WorkflowListItemSchema>

/** A single trigger input field extracted from the workflow's input-definition block. */
const v2WorkflowInputFieldSchema = z.object({
  name: z.string(),
  type: z.string(),
  description: z.string().optional(),
})

export const v2WorkflowDetailSchema = v2WorkflowListItemSchema.extend({
  /**
   * Workflow-scoped variables keyed by variable id. Each value is a structured
   * variable object (`{ id, name, type, value, ... }`); only the inner `value`
   * is user-defined/free-form. Kept as `unknown` to tolerate legacy/unstamped
   * rows — tightening to a concrete object schema later is consumer-safe (the
   * wire already carries the full object), so it stays additively evolvable.
   */
  variables: z.record(z.string(), z.unknown()),
  inputs: z.array(v2WorkflowInputFieldSchema),
})

export type V2WorkflowDetail = z.output<typeof v2WorkflowDetailSchema>

/**
 * Undeploy returns the deployment state without a version number. Derived from
 * the exported v1 deploy data schema (its private base is not exported) so the
 * shape stays in lockstep with v1.
 */
const v2UndeployWorkflowDataSchema = v1DeployWorkflowDataSchema.omit({ version: true })

export const v2ListWorkflowsContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/workflows',
  query: v2ListWorkflowsQuerySchema,
  response: {
    mode: 'json',
    schema: v2CursorListResponse(v2WorkflowListItemSchema),
  },
})

export const v2GetWorkflowContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/workflows/[id]',
  params: workflowIdParamsSchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2WorkflowDetailSchema),
  },
})

/**
 * Create body. `workspaceId` is required — personal (workspace-less) workflows
 * are not creatable on any surface. Name collisions inside the target folder
 * are a 409 rather than being silently deduplicated: a public caller that asked
 * for a name should learn it was taken, not discover "My Agent (2)" later.
 */
export const v2CreateWorkflowBodySchema = z
  .object({
    workspaceId: workspaceIdSchema,
    name: z.string().trim().min(1, 'name is required').max(255, 'name is too long'),
    description: z.string().max(50_000, 'description is too long').nullable().optional(),
    /** Omission creates the workflow at the workspace root. */
    folderPath: v2FolderPathInputSchema.optional(),
  })
  .strict()
export type V2CreateWorkflowBody = z.input<typeof v2CreateWorkflowBodySchema>

/** Update body. Omitted fields keep their stored values. */
export const v2UpdateWorkflowBodySchema = z
  .object({
    name: z.string().trim().min(1, 'name cannot be empty').max(255, 'name is too long').optional(),
    description: z.string().max(50_000, 'description is too long').nullable().optional(),
    folderPath: v2FolderPathInputSchema.optional(),
  })
  .strict()
  .superRefine((body, ctx) => {
    if (
      body.name === undefined &&
      body.description === undefined &&
      body.folderPath === undefined
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['name'],
        message: 'At least one of name, description, or folderPath is required',
      })
    }
  })
export type V2UpdateWorkflowBody = z.input<typeof v2UpdateWorkflowBodySchema>

export const v2DeleteWorkflowDataSchema = z.object({
  id: z.string(),
  deleted: z.literal(true),
})
export type V2DeleteWorkflowData = z.output<typeof v2DeleteWorkflowDataSchema>

export const v2CreateWorkflowContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/workflows',
  body: v2CreateWorkflowBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2WorkflowListItemSchema),
  },
})

export const v2UpdateWorkflowContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/v2/workflows/[id]',
  params: workflowIdParamsSchema,
  body: v2UpdateWorkflowBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2WorkflowListItemSchema),
  },
})

export const v2DeleteWorkflowContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/v2/workflows/[id]',
  params: workflowIdParamsSchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2DeleteWorkflowDataSchema),
  },
})

export const v2WorkflowFolderSchema = v2FolderSchema.extend({ locked: z.boolean() })
export type V2WorkflowFolder = z.output<typeof v2WorkflowFolderSchema>

export const v2WorkflowFolderDataSchema = z.object({ folder: v2WorkflowFolderSchema })

export const v2DeleteWorkflowFolderDataSchema = z.object({
  path: v2FolderPathSchema,
  deleted: z.literal(true),
  deletedItems: z.object({ folders: z.number().int(), workflows: z.number().int() }),
})

export const v2ListWorkflowFoldersContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/workflows/folders',
  query: v2ListFoldersQuerySchema,
  response: { mode: 'json', schema: v2CursorListResponse(v2WorkflowFolderSchema) },
})

export const v2CreateWorkflowFolderContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/workflows/folders',
  body: v2CreateFolderBodySchema,
  response: { mode: 'json', schema: v2DataResponse(v2WorkflowFolderDataSchema) },
})

export const v2RelocateWorkflowFolderContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/v2/workflows/folders',
  body: v2RelocateFolderBodySchema,
  response: { mode: 'json', schema: v2DataResponse(v2WorkflowFolderDataSchema) },
})

export const v2DeleteWorkflowFolderContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/v2/workflows/folders',
  query: v2DeleteFolderQuerySchema,
  response: { mode: 'json', schema: v2DataResponse(v2DeleteWorkflowFolderDataSchema) },
})

/**
 * A deployment version as the public surface sees it: the internal row minus
 * `createdBy`, which is a raw user id with no public resolution path —
 * `deployedBy` already carries the human-readable name.
 */
export const v2WorkflowVersionSchema = deploymentVersionSchema.omit({ createdBy: true })
export type V2WorkflowVersion = z.output<typeof v2WorkflowVersionSchema>

/**
 * Version listing is cursor-paginated: a workflow accrues one version per
 * deploy and nothing prunes them, so the set is unbounded. The cursor is keyed
 * on the version number, which is dense and strictly descending.
 */
export const v2ListWorkflowVersionsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  cursor: z.string().optional(),
})
export type V2ListWorkflowVersionsQuery = z.output<typeof v2ListWorkflowVersionsQuerySchema>

/**
 * A single version plus the workflow state it pins. `state` is the deployed
 * graph snapshot — the same portable blob the internal deployment reader
 * serves — and is the thing a caller diffs before rolling back to it.
 */
export const v2WorkflowVersionDetailSchema = z.object({
  id: z.string(),
  version: z.number().int().positive(),
  name: z.string().nullable(),
  description: z.string().nullable(),
  isActive: z.boolean(),
  createdAt: z.string(),
  state: deployedWorkflowStateSchema,
})
export type V2WorkflowVersionDetail = z.output<typeof v2WorkflowVersionDetailSchema>

export const v2ListWorkflowVersionsContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/workflows/[id]/versions',
  params: workflowIdParamsSchema,
  query: v2ListWorkflowVersionsQuerySchema,
  response: {
    mode: 'json',
    schema: v2CursorListResponse(v2WorkflowVersionSchema),
  },
})

export const v2GetWorkflowVersionContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/workflows/[id]/versions/[version]',
  params: deploymentVersionParamsSchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2WorkflowVersionDetailSchema),
  },
})

export const v2DeployWorkflowContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/workflows/[id]/deploy',
  params: workflowIdParamsSchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v1DeployWorkflowDataSchema),
  },
})

export const v2UndeployWorkflowContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/v2/workflows/[id]/deploy',
  params: workflowIdParamsSchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2UndeployWorkflowDataSchema),
  },
})

export const v2RollbackWorkflowContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/workflows/[id]/rollback',
  params: workflowIdParamsSchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v1RollbackWorkflowDataSchema),
  },
})

/**
 * Structured execution error — mirrors `WorkflowExecutionErrorCode` in
 * `@/executor/utils/errors` (duplicated literally: contracts are
 * client-importable and must not pull executor modules). APPEND-ONLY: callers
 * route on these instead of substring-matching messages.
 */
export const v2ExecutionErrorSchema = z.object({
  message: z.string(),
  code: z.enum([
    'TIMEOUT',
    'CANCELLED',
    'USAGE_LIMIT_EXCEEDED',
    'INVALID_INPUT',
    'BLOCK_EXECUTION_FAILED',
    'CHILD_WORKFLOW_FAILED',
    'OUTPUT_TOO_LARGE',
    'EXECUTION_FAILED',
  ]),
  /** Failing block, when attributable. Deliberately crosses the workspace boundary for shared/child workflows — the executionId + block context is the reproducible handle a caller hands the workflow provider. */
  blockId: z.string().optional(),
  blockName: z.string().optional(),
  blockType: z.string().optional(),
})
export type V2ExecutionError = z.output<typeof v2ExecutionErrorSchema>

/**
 * Strict public execute body. Async is body-selected (`async: true`) — v2 has
 * no `X-Execution-Mode`/`X-Stream-Response` headers. Internal caller facts
 * (triggerType, draft state, deployment pinning) are NEVER wire fields; they
 * are typed options on the execution service.
 */
export const v2ExecuteWorkflowBodySchema = z
  .object({
    input: z.record(z.string(), z.unknown()).optional(),
    async: z.boolean().optional().default(false),
    stream: z.boolean().optional().default(false),
    selectedOutputs: z.array(z.string().min(1)).max(100).optional(),
    includeThinking: z.boolean().optional().default(false),
    includeToolCalls: z.boolean().optional().default(false),
    includeFileBase64: z.boolean().optional(),
    /** Caps inline base64 file hydration; bounded (v1 leaves it unbounded). */
    base64MaxBytes: z
      .number()
      .int()
      .positive()
      .max(10 * 1024 * 1024)
      .optional(),
  })
  .strict()
export type V2ExecuteWorkflowBody = z.input<typeof v2ExecuteWorkflowBodySchema>

/**
 * The execution result resource. In-band run failures are `status: 'failed'`
 * with a structured `error` — never an HTTP error: **an `executionId` means
 * 200/202 + `data`; no `executionId` means the `v2Error` envelope.** The sync
 * timeout is `status:'failed'` + `error.code:'TIMEOUT'` (v1 returned 408).
 */
export const v2ExecuteWorkflowDataSchema = z.object({
  executionId: z.string(),
  workflowId: z.string(),
  status: z.enum(['completed', 'failed', 'paused', 'cancelled']),
  output: z.unknown(),
  error: v2ExecutionErrorSchema.nullable(),
  startedAt: z.string().optional(),
  endedAt: z.string().optional(),
  durationMs: z.number().optional(),
})
export type V2ExecuteWorkflowData = z.output<typeof v2ExecuteWorkflowDataSchema>

/** 202 receipt for `async: true` — poll `statusUrl` (the v2 executions resource). */
export const v2ExecuteWorkflowQueuedSchema = z.object({
  executionId: z.string(),
  statusUrl: z.string(),
})
export type V2ExecuteWorkflowQueued = z.output<typeof v2ExecuteWorkflowQueuedSchema>

export const v2ExecuteWorkflowContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/workflows/[id]/execute',
  params: workflowIdParamsSchema,
  body: v2ExecuteWorkflowBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2ExecuteWorkflowDataSchema),
  },
})

/** Resume input is scoped to one pause context on the parent execution. */
export const v2ResumeWorkflowBodySchema = z
  .object({
    contextId: z.string().min(1, 'contextId cannot be empty'),
    input: z.unknown().optional(),
  })
  .strict()
export type V2ResumeWorkflowBody = z.input<typeof v2ResumeWorkflowBodySchema>

export const v2ResumeWorkflowQueuedSchema = v2ExecuteWorkflowQueuedSchema.extend({
  queuePosition: z.number().int().positive().optional(),
})
export type V2ResumeWorkflowQueued = z.output<typeof v2ResumeWorkflowQueuedSchema>

export const v2ResumeWorkflowContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/workflows/[id]/executions/[executionId]/resume',
  params: workflowExecutionParamsSchema,
  body: v2ResumeWorkflowBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2ExecuteWorkflowDataSchema),
  },
})

export const v2WorkflowExecutionStatusValueSchema = z.enum([
  'queued',
  'pending',
  'running',
  'completed',
  'failed',
  'cancelled',
  'paused',
])

export const v2WorkflowExecutionListStatusValueSchema = z.enum([
  'pending',
  'running',
  'completed',
  'failed',
  'cancelled',
  'paused',
])

export const v2ListWorkflowExecutionsQuerySchema = z
  .object({
    status: v2WorkflowExecutionListStatusValueSchema.optional(),
    trigger: z.string().min(1, 'trigger cannot be empty').optional(),
    startDate: z.string().datetime().optional(),
    endDate: z.string().datetime().optional(),
    limit: z.coerce.number().int().min(1).max(100).optional().default(50),
    cursor: z.string().min(1, 'cursor cannot be empty').optional(),
    order: z.enum(['asc', 'desc']).optional().default('desc'),
  })
  .strict()
  .refine(
    (query) =>
      !query.startDate ||
      !query.endDate ||
      Date.parse(query.startDate) <= Date.parse(query.endDate),
    {
      message: 'startDate must be before or equal to endDate',
      path: ['startDate'],
    }
  )

export type V2ListWorkflowExecutionsQuery = z.output<typeof v2ListWorkflowExecutionsQuerySchema>

export const v2WorkflowExecutionListItemSchema = z.object({
  executionId: z.string(),
  workflowId: z.string(),
  status: v2WorkflowExecutionListStatusValueSchema,
  trigger: z.string(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  durationMs: z.number().nullable(),
  cost: z.object({ total: z.number() }).nullable(),
})

export type V2WorkflowExecutionListItem = z.output<typeof v2WorkflowExecutionListItemSchema>

export const v2ListWorkflowExecutionsContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/workflows/[id]/executions',
  params: workflowIdParamsSchema,
  query: v2ListWorkflowExecutionsQuerySchema,
  response: {
    mode: 'json',
    schema: v2CursorListResponse(v2WorkflowExecutionListItemSchema),
  },
})

/**
 * The polled execution resource. `queued` is backfilled from the async job
 * queue before the worker writes the durable log row — v1's jobs endpoint 404
 * window doesn't exist here. `error` is the same structured object the execute
 * response carries.
 */
export const v2WorkflowExecutionStatusSchema = z.object({
  executionId: z.string(),
  workflowId: z.string(),
  status: v2WorkflowExecutionStatusValueSchema,
  trigger: z.string().nullable(),
  startedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
  durationMs: z.number().nullable(),
  paused: workflowExecutionPausedDetailSchema.nullable(),
  cost: z.object({ total: z.number() }).nullable(),
  error: v2ExecutionErrorSchema.nullable(),
  /** Populated only with `includeOutput=true` on completed runs. */
  output: z.unknown().nullable(),
  blockOutputs: z.record(z.string(), z.unknown()).nullable(),
})
export type V2WorkflowExecutionStatus = z.output<typeof v2WorkflowExecutionStatusSchema>

export const v2GetWorkflowExecutionContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/workflows/[id]/executions/[executionId]',
  params: workflowExecutionParamsSchema,
  query: workflowExecutionStatusQuerySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2WorkflowExecutionStatusSchema),
  },
})

export const v2CancelWorkflowExecutionDataSchema = z.object({
  success: z.boolean(),
  executionId: z.string(),
  redisAvailable: z.boolean(),
  durablyRecorded: z.boolean(),
  locallyAborted: z.boolean(),
  pausedCancelled: z.boolean(),
  reason: cancelWorkflowExecutionReasonSchema.optional(),
})
export type V2CancelWorkflowExecutionData = z.output<typeof v2CancelWorkflowExecutionDataSchema>

export const v2CancelWorkflowExecutionContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/workflows/[id]/executions/[executionId]/cancel',
  params: workflowExecutionParamsSchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2CancelWorkflowExecutionDataSchema),
  },
})

export const v2WorkflowExportPayloadSchema = v1WorkflowExportPayloadSchema.extend({
  workflow: v1WorkflowExportPayloadSchema.shape.workflow
    .omit({ folderId: true })
    .extend({ folderPath: v2FolderPathSchema }),
})

export const v2ImportWorkflowBodySchema = v1ImportWorkflowBodySchema
  .omit({ folderId: true, name: true, description: true })
  .extend({
    folderPath: v2FolderPathInputSchema.optional(),
    name: z
      .string()
      .min(1, 'name cannot be empty')
      .max(
        V1_IMPORT_NAME_MAX_LENGTH,
        `name must be at most ${V1_IMPORT_NAME_MAX_LENGTH} characters`
      )
      .optional(),
    description: z
      .string()
      .max(
        V1_IMPORT_DESCRIPTION_MAX_LENGTH,
        `description must be at most ${V1_IMPORT_DESCRIPTION_MAX_LENGTH} characters`
      )
      .optional(),
  })
  .strict()

export const v2ImportWorkflowDataSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  workspaceId: z.string(),
  folderPath: v2FolderPathSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const v2ExportWorkflowContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/workflows/[id]/export',
  params: workflowIdParamsSchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2WorkflowExportPayloadSchema),
  },
})

export const v2ImportWorkflowContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/workflows/import',
  body: v2ImportWorkflowBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2ImportWorkflowDataSchema),
  },
})
