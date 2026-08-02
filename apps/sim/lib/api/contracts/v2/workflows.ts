import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'
import {
  v1DeployWorkflowDataSchema,
  v1ImportWorkflowBodySchema,
  v1ImportWorkflowDataSchema,
  v1ListWorkflowsQuerySchema,
  v1RollbackWorkflowDataSchema,
  v1WorkflowExportPayloadSchema,
} from '@/lib/api/contracts/v1/workflows'
import {
  v2CursorListResponse,
  v2DataResponse,
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
export const v2ListWorkflowsQuerySchema = v1ListWorkflowsQuerySchema.extend({
  search: v2SearchSchema,
  ...v2SortFields(v2WorkflowSortFields, { sortBy: 'position', sortOrder: 'asc' }),
})

export type V2ListWorkflowsQuery = z.output<typeof v2ListWorkflowsQuerySchema>

export const v2WorkflowListItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  folderId: z.string().nullable(),
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

/**
 * The polled execution resource. `queued` is backfilled from the async job
 * queue before the worker writes the durable log row — v1's jobs endpoint 404
 * window doesn't exist here. `error` is the same structured object the execute
 * response carries.
 */
export const v2WorkflowExecutionStatusSchema = z.object({
  executionId: z.string(),
  workflowId: z.string(),
  status: z.enum(['queued', 'pending', 'running', 'completed', 'failed', 'cancelled', 'paused']),
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

/**
 * Export/import reuse the v1 payload and body schemas verbatim — the portable
 * envelope must round-trip across both surfaces — with only the response
 * envelope upgraded.
 */
export const v2ExportWorkflowContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/workflows/[id]/export',
  params: workflowIdParamsSchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v1WorkflowExportPayloadSchema),
  },
})

export const v2ImportWorkflowContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/workflows/import',
  body: v1ImportWorkflowBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v1ImportWorkflowDataSchema),
  },
})
