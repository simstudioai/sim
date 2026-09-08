import {
  BLOCK_RETRY_MAX_TRIES,
  BLOCK_RETRY_MAX_WAIT_MS,
  BLOCK_RETRY_MIN_TRIES,
  BLOCK_RETRY_MIN_WAIT_MS,
} from '@sim/workflow-types/workflow'
import { z } from 'zod'
import {
  activeDeploymentSummarySchema,
  deployedWorkflowStateSchema,
  deploymentOperationSummarySchema,
  deploymentVersionNumberSchema,
  deploymentVersionOrActiveParamsSchema,
  deploymentVersionParamsSchema,
  deploymentVersionSchema,
  updatePublicApiBodySchema,
} from '@/lib/api/contracts/deployments'
import {
  booleanQueryFlagSchema,
  MAX_ID_LENGTH,
  missingFieldError,
  noInputSchema,
  runIdSchema,
  workspaceIdSchema,
} from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import {
  V1_IMPORT_DESCRIPTION_MAX_LENGTH,
  V1_IMPORT_NAME_MAX_LENGTH,
  v1DeployWorkflowBodySchema,
  v1ImportWorkflowBodySchema,
  v1RollbackWorkflowBodySchema,
  v1WorkflowExportPayloadSchema,
} from '@/lib/api/contracts/v1/workflows'
import {
  V2_FOLDER_FILTER_MISS,
  v2CreateFolderBodySchema,
  v2CursorListResponse,
  v2DataResponse,
  v2DeleteFolderQuerySchema,
  v2FolderPathInputSchema,
  v2FolderPathSchema,
  v2FolderSchema,
  v2ListFoldersQuerySchema,
  v2PaginationFields,
  v2RelocateFolderBodySchema,
  v2ResourceWebUrlSchema,
  v2RunOrderSchema,
  v2RunWindowBoundSchema,
  v2SearchSchema,
  v2SortFields,
} from '@/lib/api/contracts/v2/shared'
import {
  cancelWorkflowExecutionReasonSchema,
  workflowExecutionPausedDetailSchema,
  workflowExecutionStatusQuerySchema,
  workflowIdParamsSchema,
} from '@/lib/api/contracts/workflows'
import { MAX_WORKFLOW_EXECUTION_TIMEOUT_SECONDS } from '@/lib/billing/execution-timeout-defaults'
import { MAX_INLINE_MATERIALIZATION_BYTES } from '@/lib/execution/payloads/limits'
import { PERSISTED_WORKFLOW_EXECUTION_STATUSES } from '@/lib/logs/types'
import { MAX_MCP_TOOL_NAME_BYTES } from '@/lib/mcp/constants'
import { WORKFLOW_SKIPPED_ITEM_TYPES } from '@/lib/workflows/editing/types'

export const V2_WORKFLOW_RUN_ID_HEADER = 'X-Run-Id'

export const v2WorkflowRunIdSchema = runIdSchema
  .describe('Unique workflow run identifier.')
  .meta({ examples: ['run_8f14e45f-ceea-467f-a'] })

/**
 * `X-Run-Id` reserves an execution ID without guaranteeing a retrievable run.
 * Claims can survive uncertain execution outcomes; a missing run does not make
 * a claimed ID reusable. Reusing a claimed ID returns a conflict, never a replay.
 */
const X_RUN_ID_DESCRIPTION =
  'Run ID for API-key or OAuth callers; ignored for anonymous requests. Reuse it after an uncertain response: a claimed ID returns `409` with `RUN_ID_CONFLICT`, without replaying results. Check Get Workflow Run, but `404` can persist while the ID remains claimed and does not establish whether execution started. Do not automatically restart with a fresh or omitted ID; either can start another run.'

const X_SIM_VIA_DESCRIPTION =
  'Comma-separated workflow identifiers naming the workflow-to-workflow call chain that led to this request. Each hop appends its own workflow id, and Sim sets it automatically; supply it yourself only when relaying an existing chain. A chain at the maximum depth is rejected with `409` and `error.details.code: "CALL_CHAIN_DEPTH_EXCEEDED"`.'

export const v2ExecuteWorkflowHeadersSchema = z
  .object({
    'x-run-id': v2WorkflowRunIdSchema.optional().describe(X_RUN_ID_DESCRIPTION),
    'x-sim-via': z.string().optional().describe(X_SIM_VIA_DESCRIPTION),
  })
  .meta({
    id: 'ExecuteWorkflowHeaders',
    title: 'Execute workflow headers',
    description:
      'Optional one-shot run-identifier claim and workflow call-chain marker for a workflow execution.',
  })
export type V2ExecuteWorkflowHeaders = z.input<typeof v2ExecuteWorkflowHeadersSchema>

export const v2WorkflowRunParamsSchema = z
  .object({
    workflowId: z.string().min(1, 'Invalid workflow ID').describe('Unique workflow identifier.'),
    runId: v2WorkflowRunIdSchema.describe('Unique workflow run identifier.'),
  })
  .meta({
    id: 'WorkflowRunParams',
    title: 'Workflow run path parameters',
    description: 'Workflow and run selected by the request path.',
  })
export type V2WorkflowRunParams = z.input<typeof v2WorkflowRunParamsSchema>

/**
 * v2 workflows contracts. Request shapes are reused from v1 (the workflow-id
 * param is unchanged, spelled `[workflowId]` here and `[id]` in v1, and the list query extends v1's with the v2 search/sort
 * convention); only the response envelope is upgraded to the canonical v2
 * shapes with concrete item/detail schemas. Deploy, rollback, and undeploy
 * have named v2 lifecycle result schemas and use `v2DataResponse` (the v1
 * `limits` body field is dropped — v2 carries rate-limit state in headers and
 * usage on a dedicated endpoint).
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
/**
 * Listing scopes. Two-valued on purpose, diverging from the three-valued
 * internal `workflowScopeSchema`: `all` drops the `archived_at` predicate
 * entirely, so it can use neither of the workflow table's two partial indexes
 * and degrades to a full workspace scan. Mirrors `v2FileScopeSchema`.
 */
export const v2WorkflowScopeSchema = z.enum(['active', 'archived'])

export type V2WorkflowScope = z.output<typeof v2WorkflowScopeSchema>

export const v2ListWorkflowsQuerySchema = z
  .object({
    workspaceId: workspaceIdSchema.describe('Workspace whose workflows should be listed.'),
    scope: v2WorkflowScopeSchema
      .default('active')
      .describe(
        'Which lifecycle set to list: `active` (default) for live workflows, `archived` for workflows a `DELETE` archived. The folder filter resolves against active folders only, so pairing it with `archived` returns an empty page when the containing folder was archived too.'
      ),
    folderPath: v2FolderPathInputSchema
      .optional()
      .describe(`Restrict results to workflows in this folder path. ${V2_FOLDER_FILTER_MISS}`),
    deployedOnly: booleanQueryFlagSchema
      .optional()
      .default(false)
      .describe('Return only workflows with an active deployment when true.'),
    ...v2PaginationFields({ description: 'Maximum workflows to return per page.' }),
    search: v2SearchSchema,
    ...v2SortFields(v2WorkflowSortFields, { sortBy: 'position', sortOrder: 'asc' }),
  })
  .strict()
  .meta({
    id: 'ListWorkflowsQuery',
    title: 'List workflows query',
    description: 'Workspace, folder, deployment, search, sorting, and pagination filters.',
  })

export type V2ListWorkflowsQuery = z.output<typeof v2ListWorkflowsQuerySchema>

export const v2WorkflowListItemSchema = z
  .object({
    id: z
      .string()
      .describe('Unique workflow identifier.')
      .meta({ examples: ['3b1f7c92-8d4e-4a6b-9c0d-5e2f8a714b36'] }),
    webUrl: v2ResourceWebUrlSchema,
    name: z
      .string()
      .describe('Workflow name.')
      .meta({ examples: ['Customer support triage'] }),
    description: z.string().nullable().describe('Workflow description, or null when none is set.'),
    folderPath: v2FolderPathSchema
      .describe('Canonical containing-folder path; `/` is the workspace root.')
      .meta({ examples: ['/Operations'] }),
    workspaceId: z.string().describe('Workspace that owns the workflow.'),
    isDeployed: z.boolean().describe('Whether the workflow has an active deployment.'),
    deployedAt: z
      .string()
      .nullable()
      .describe('ISO 8601 activation timestamp, or null when not deployed.')
      .meta({ format: 'date-time' }),
    /**
     * A monotonic column on the workflow row, not an aggregate over the run
     * list. `updateWorkflowRunCounts` is called from exactly one place —
     * `executeWorkflowCore`'s post-execution hook, under
     * `result.success && result.status !== 'paused'` — and nothing ever
     * decrements it, so the two ways it disagrees with
     * `GET /workflows/{workflowId}/runs` point in opposite directions and both are
     * reachable at once. The description is what makes that legible; the
     * counter itself is left alone because its stored values already carry the
     * narrow meaning and no backfill can recover runs whose logs retention has
     * already deleted.
     */
    runCount: z
      .number()
      .int()
      .nonnegative()
      .describe(
        'Lifetime count of successful runs, excluding failed, canceled, and paused runs. Log retention does not reduce this count; it may differ from the number returned by List Workflow Runs.'
      ),
    lastRunAt: z
      .string()
      .nullable()
      .describe(
        'ISO 8601 timestamp of the latest run counted by `runCount`, or null when none has been. Stamped by the same successful-run path, so a workflow whose only runs failed reports null here.'
      )
      .meta({ format: 'date-time' }),
    createdAt: z
      .string()
      .describe('ISO 8601 timestamp when the workflow was created.')
      .meta({ format: 'date-time' }),
    updatedAt: z
      .string()
      .describe('ISO 8601 timestamp when the workflow was last updated.')
      .meta({ format: 'date-time' }),
  })
  .meta({
    id: 'WorkflowListItem',
    title: 'Workflow summary',
    description: 'Summary of a workflow and its deployment and run state.',
  })

export type V2WorkflowListItem = z.output<typeof v2WorkflowListItemSchema>

/** A single trigger input field extracted from the workflow's input-definition block. */
const v2WorkflowInputFieldSchema = z
  .object({
    name: z.string().describe('Input field name.'),
    type: z.string().describe('Input field type.'),
    description: z.string().optional().describe('Optional input field description.'),
  })
  .meta({
    id: 'WorkflowInputField',
    title: 'Workflow input field',
    description: 'A deployed API trigger input exposed by a workflow.',
  })

export const v2WorkflowDetailSchema = v2WorkflowListItemSchema
  .extend({
    /**
     * Workflow-scoped variables keyed by variable id. Each value is a structured
     * variable object (`{ id, name, type, value, ... }`); only the inner `value`
     * is user-defined/free-form. Kept as `unknown` to tolerate legacy/unstamped
     * rows — tightening to a concrete object schema later is consumer-safe (the
     * wire already carries the full object), so it stays additively evolvable.
     */
    variables: z
      .record(z.string(), z.unknown().describe('Structured workflow variable value.'))
      .describe('Workflow-scoped variables keyed by variable identifier.'),
    inputs: z
      .array(v2WorkflowInputFieldSchema)
      .describe('Input fields exposed by the workflow API trigger.'),
  })
  .meta({
    id: 'WorkflowDetail',
    title: 'Workflow detail',
    description: 'Full workflow summary with variables and API-trigger input fields.',
  })

export type V2WorkflowDetail = z.output<typeof v2WorkflowDetailSchema>

export const v2WorkflowIdParamsSchema = workflowIdParamsSchema
  .omit({ id: true })
  .extend({
    workflowId: workflowIdParamsSchema.shape.id
      .describe('Unique workflow identifier.')
      .meta({ examples: ['3b1f7c92-8d4e-4a6b-9c0d-5e2f8a714b36'] }),
  })
  .meta({
    id: 'WorkflowIdParams',
    title: 'Workflow path parameters',
    description: 'Workflow selected by the request path.',
  })

export const v2DeploymentVersionParamsSchema = deploymentVersionParamsSchema
  .omit({ id: true })
  .extend({
    workflowId: deploymentVersionParamsSchema.shape.id.describe('Unique workflow identifier.'),
    version: deploymentVersionParamsSchema.shape.version
      .describe('Numeric deployment version.')
      .meta({ examples: [3] }),
  })
  .meta({
    id: 'WorkflowVersionParams',
    title: 'Workflow version path parameters',
    description: 'Workflow and deployment version selected by the request path.',
  })

/**
 * Version path parameters that also accept the literal `active`. Only the
 * revert operation takes this form: loading "whatever is live" into the draft
 * is a meaningful request, whereas activating or relabelling the already-active
 * version is not, so the other two keep the numeric-only schema.
 */
export const v2DeploymentVersionOrActiveParamsSchema = deploymentVersionOrActiveParamsSchema
  .omit({ id: true })
  .extend({
    workflowId: deploymentVersionOrActiveParamsSchema.shape.id.describe(
      'Unique workflow identifier.'
    ),
    version: deploymentVersionOrActiveParamsSchema.shape.version
      .describe('Numeric deployment version, or `active` for the currently live version.')
      .meta({ examples: [3, 'active'] }),
  })
  .meta({
    id: 'WorkflowVersionOrActiveParams',
    title: 'Workflow version path parameters',
    description:
      'Workflow and deployment version selected by the request path, where the version may be the literal `active`.',
  })

export const v2DeploymentStateSchema = z
  .object({
    id: z
      .string()
      .describe('Unique workflow identifier.')
      .meta({ examples: ['3b1f7c92-8d4e-4a6b-9c0d-5e2f8a714b36'] }),
    isDeployed: z
      .boolean()
      .describe('Whether a workflow version is currently live and available for API execution.'),
    deployedAt: z
      .string()
      .nullable()
      .describe('ISO 8601 timestamp associated with the deployment, or null when unavailable.')
      .meta({ format: 'date-time', examples: ['2026-06-12T10:30:00.000Z'] }),
    warnings: z
      .array(z.string())
      .describe('Non-fatal synchronization warnings. Empty when there is nothing to report.'),
    activeDeployment: activeDeploymentSummarySchema
      .nullable()
      .describe('Currently live deployment version, or null while no version is active.'),
    latestDeploymentAttempt: deploymentOperationSummarySchema
      .nullable()
      .describe('Most recent deployment lifecycle attempt, or null when none is available.'),
  })
  .meta({
    id: 'DeploymentState',
    title: 'Deployment state',
    description: 'Current workflow deployment state and lifecycle progress.',
  })

/**
 * Read-only deployment state. Extends the shared state with `needsRedeployment`,
 * which the mutation responses cannot carry: it compares the live graph against
 * the draft, and immediately after a deploy or rollback the two are equal by
 * construction — and with `isPublicApi`, which was write-only across the whole
 * surface until this read published it.
 */
export const v2WorkflowDeploymentSchema = v2DeploymentStateSchema
  .extend({
    needsRedeployment: z
      .boolean()
      .describe(
        'Whether the editable draft has diverged from the live deployment version. False while a deployment attempt is still preparing or activating, and false when nothing is deployed.'
      ),
    isPublicApi: z
      .boolean()
      .describe(
        'Whether anyone with the execution URL can run the deployed workflow and consume billed usage without an API key. Change this with Update Workflow Public API Access.'
      ),
  })
  .meta({
    id: 'WorkflowDeployment',
    title: 'Workflow deployment',
    description:
      'Current deployment state of a workflow, including draft-versus-live drift and the most recent deployment attempt.',
  })

export type V2WorkflowDeployment = z.output<typeof v2WorkflowDeploymentSchema>

export const v2DeployWorkflowDataSchema = v2DeploymentStateSchema
  .extend({
    version: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('Deployment version created for this attempt, when available.'),
  })
  .meta({
    id: 'DeployResult',
    title: 'Deploy result',
    description:
      'Deployment attempt accepted for asynchronous activation. `latestDeploymentAttempt` identifies the attempt. Poll Get Workflow Deployment for `isDeployed` and `deployedAt`, or List Workflow Versions for `isActive`.',
  })
export type V2DeployWorkflowData = z.output<typeof v2DeployWorkflowDataSchema>

export const v2UndeployWorkflowDataSchema = v2DeploymentStateSchema.extend({}).meta({
  id: 'UndeployResult',
  title: 'Undeploy result',
  description:
    'Deployment state after a successful undeploy. `isDeployed` is false and no workflow version is active.',
})
export type V2UndeployWorkflowData = z.output<typeof v2UndeployWorkflowDataSchema>

export const v2RollbackWorkflowDataSchema = v2DeploymentStateSchema
  .extend({
    version: z.number().int().positive().describe('Deployment version selected for re-activation.'),
  })
  .meta({
    id: 'RollbackResult',
    title: 'Rollback result',
    description:
      'Rollback attempt accepted for processing. Activation is asynchronous; inspect `isDeployed` and `latestDeploymentAttempt` for current state.',
  })
export type V2RollbackWorkflowData = z.output<typeof v2RollbackWorkflowDataSchema>

/**
 * The same shape under an activation-shaped name.
 *
 * `POST /versions/{version}/activate` and `POST /rollback` return identical
 * data, but publishing the activate response as `RollbackResult` named and
 * described a generated client's activate type as a rollback. The component id
 * `RollbackResult` stays on rollback, where shipped clients already depend on
 * it; activate gets its own rather than renaming theirs.
 */
export const v2ActivateWorkflowVersionDataSchema = v2RollbackWorkflowDataSchema.meta({
  id: 'VersionActivationResult',
  title: 'Version activation result',
  description:
    'Activation attempt accepted for processing. Activation is asynchronous; inspect `isDeployed` and `latestDeploymentAttempt` for current state.',
})
export type V2ActivateWorkflowVersionData = z.output<typeof v2ActivateWorkflowVersionDataSchema>

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
  path: '/api/v2/workflows/[workflowId]',
  query: noInputSchema,
  params: v2WorkflowIdParamsSchema,
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
    workspaceId: workspaceIdSchema.describe('Workspace in which to create the workflow.'),
    name: z
      .string({ error: missingFieldError('name is required') })
      .trim()
      .min(1, 'name is required')
      .max(255, 'name is too long')
      .describe('Workflow name.'),
    description: z
      .string()
      .max(50_000, 'description is too long')
      .nullable()
      .optional()
      .describe('Optional workflow description.'),
    /** Omission creates the workflow at the workspace root. */
    folderPath: v2FolderPathInputSchema.optional(),
  })
  .strict()
  .meta({
    id: 'CreateWorkflowRequest',
    title: 'Create workflow request',
    description: 'Name, description, workspace, and optional folder for a new workflow.',
    examples: [
      {
        workspaceId: 'a91c4b2e-6d3f-4e8a-b5c7-0d9e2f1a8c64',
        name: 'Customer support triage',
        folderPath: '/Operations',
      },
    ],
  })
export type V2CreateWorkflowBody = z.input<typeof v2CreateWorkflowBodySchema>

/** Update body. Omitted fields keep their stored values. */
export const v2UpdateWorkflowBodySchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'name cannot be empty')
      .max(255, 'name is too long')
      .optional()
      .describe('Replacement workflow name.'),
    description: z
      .string()
      .max(50_000, 'description is too long')
      .nullable()
      .optional()
      .describe('Replacement workflow description; null clears it.'),
    folderPath: v2FolderPathInputSchema
      .optional()
      .describe('Destination folder path; `/` moves the workflow to the workspace root.'),
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
  .meta({
    id: 'UpdateWorkflowRequest',
    title: 'Update workflow request',
    description: 'Fields to update on an existing workflow.',
    examples: [{ name: 'Customer support and escalation', folderPath: '/Operations' }],
  })
export type V2UpdateWorkflowBody = z.input<typeof v2UpdateWorkflowBodySchema>

export const v2DeleteWorkflowDataSchema = z
  .object({
    id: z.string().describe('Identifier of the archived workflow.'),
    /**
     * Retained for shipped clients. `DELETE` has always archived rather than
     * erased; renaming it would break them, so `archived` states the semantics
     * alongside it.
     */
    deleted: z.literal(true).describe('Confirms that the workflow is no longer live.'),
    archived: z
      .literal(true)
      .describe(
        'Whether the workflow was archived. Restore Workflow recovers it and the schedules, webhooks, MCP tools, and chats archived with it.'
      ),
  })
  .meta({
    id: 'DeleteWorkflowResult',
    title: 'Delete workflow result',
    description: 'Confirmation that a workflow was archived.',
  })
export type V2DeleteWorkflowData = z.output<typeof v2DeleteWorkflowDataSchema>

const v2SeededBlockSchema = z
  .object({
    id: z.string().describe('Block identifier.'),
    type: z.string().describe('Registered block type.'),
    name: z.string().describe('Block display name.'),
  })
  .strict()
  .meta({
    id: 'SeededWorkflowBlock',
    title: 'Seeded workflow block',
    description: 'A block the platform placed in a newly created workflow.',
  })

/**
 * Create result. Carries the seeded blocks — deliberately a summary rather than
 * the whole graph, which would reintroduce the unbounded response
 * `GET /workflows/{workflowId}/state` exists to keep off the common path.
 */
export const v2CreateWorkflowDataSchema = v2WorkflowListItemSchema
  .extend({
    blocks: z
      .array(v2SeededBlockSchema)
      .describe(
        'Blocks seeded into the new workflow. Contains the start block; attach edges to its `id`.'
      ),
  })
  .meta({
    id: 'CreateWorkflowResult',
    title: 'Create workflow result',
    description: 'The created workflow and the blocks it was seeded with.',
  })

export type V2CreateWorkflowData = z.output<typeof v2CreateWorkflowDataSchema>

export const v2CreateWorkflowContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/workflows',
  query: noInputSchema,
  body: v2CreateWorkflowBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2CreateWorkflowDataSchema),
    status: 201,
  },
})

export const v2UpdateWorkflowContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/v2/workflows/[workflowId]',
  query: noInputSchema,
  params: v2WorkflowIdParamsSchema,
  body: v2UpdateWorkflowBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2WorkflowListItemSchema),
  },
})

export const v2DeleteWorkflowContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/v2/workflows/[workflowId]',
  query: noInputSchema,
  params: v2WorkflowIdParamsSchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2DeleteWorkflowDataSchema),
  },
})

export const v2WorkflowFolderSchema = v2FolderSchema
  .extend({ locked: z.boolean().describe('Whether the folder is currently locked for mutation.') })
  .meta({
    id: 'WorkflowFolder',
    title: 'Workflow folder',
    description: 'A canonical workflow folder and its mutation lock state.',
  })
export type V2WorkflowFolder = z.output<typeof v2WorkflowFolderSchema>

export const v2DeleteWorkflowFolderDataSchema = z
  .object({
    path: v2FolderPathSchema.describe('Path of the deleted workflow folder.'),
    deleted: z.literal(true).describe('Confirms that the folder was deleted.'),
    deletedItems: z
      .object({
        folders: z.number().int().nonnegative().describe('Number of folders deleted.'),
        workflows: z.number().int().nonnegative().describe('Number of workflows deleted.'),
      })
      .describe('Resources removed by the deletion.'),
  })
  .meta({
    id: 'DeleteWorkflowFolderResult',
    title: 'Delete workflow folder result',
    description: 'Confirmation and deletion counts for a workflow folder.',
  })

export const v2ListWorkflowFoldersContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/workflows/folders',
  query: v2ListFoldersQuerySchema,
  response: {
    mode: 'json',
    schema: v2CursorListResponse(v2WorkflowFolderSchema, { paged: false }),
  },
})

export const v2CreateWorkflowFolderContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/workflows/folders',
  query: noInputSchema,
  body: v2CreateFolderBodySchema,
  response: { mode: 'json', schema: v2DataResponse(v2WorkflowFolderSchema), status: 201 },
})

export const v2RelocateWorkflowFolderContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/v2/workflows/folders',
  query: noInputSchema,
  body: v2RelocateFolderBodySchema,
  response: { mode: 'json', schema: v2DataResponse(v2WorkflowFolderSchema) },
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
export const v2WorkflowVersionSchema = deploymentVersionSchema
  .omit({ createdBy: true })
  .extend({
    id: deploymentVersionSchema.shape.id.describe('Unique deployment-version identifier.'),
    version: deploymentVersionSchema.shape.version
      .int()
      .positive()
      .describe('Monotonically increasing deployment version number.'),
    name: deploymentVersionSchema.shape.name.describe('Optional deployment-version label.'),
    description: deploymentVersionSchema.shape.description.describe(
      'Optional deployment-version release note.'
    ),
    isActive: deploymentVersionSchema.shape.isActive.describe(
      'Whether this version is currently serving executions.'
    ),
    createdAt: deploymentVersionSchema.shape.createdAt
      .describe('ISO 8601 timestamp when this version was created.')
      .meta({ format: 'date-time' }),
    deployedBy: deploymentVersionSchema.shape.deployedBy.describe(
      'Display name of the user who created the deployment, when available.'
    ),
    latestOperationStatus: deploymentVersionSchema.shape.latestOperationStatus.describe(
      'Latest lifecycle-operation status for this version.'
    ),
  })
  .meta({
    id: 'WorkflowVersion',
    title: 'Workflow version',
    description: 'A saved deployment version of a workflow.',
  })
export type V2WorkflowVersion = z.output<typeof v2WorkflowVersionSchema>

/**
 * Version listing is cursor-paginated: a workflow accrues one version per
 * deploy and nothing prunes them, so the set is unbounded. The cursor is keyed
 * on the version number, which is dense and strictly descending.
 */
export const v2ListWorkflowVersionsQuerySchema = z
  .object({
    ...v2PaginationFields({ description: 'Maximum deployment versions to return per page.' }),
  })
  .strict()
  .meta({
    id: 'ListWorkflowVersionsQuery',
    title: 'List workflow versions query',
    description: 'Pagination for deployment versions of a workflow.',
  })
export type V2ListWorkflowVersionsQuery = z.output<typeof v2ListWorkflowVersionsQuerySchema>

/**
 * Payload of the opaque cursor this list mints. A cursor is caller-controlled
 * bytes, so its decoded `version` is validated exactly like a request field —
 * it is compared against the `integer` column, where an out-of-range value
 * overflows the comparison rather than matching nothing.
 */
export const v2WorkflowVersionCursorSchema = z
  .object({
    version: deploymentVersionNumberSchema.describe('Version at which the next page begins.'),
  })
  .strict()
export type V2WorkflowVersionCursor = z.output<typeof v2WorkflowVersionCursorSchema>

/**
 * A single version plus the workflow state it pins. `state` is the deployed
 * graph snapshot — the same portable blob the internal deployment reader
 * serves — and is the thing a caller diffs before rolling back to it.
 */
export const v2WorkflowVersionDetailSchema = z
  .object({
    id: z.string().describe('Unique deployment-version identifier.'),
    version: z
      .number()
      .int()
      .positive()
      .describe('Monotonically increasing deployment version number.'),
    name: z.string().nullable().describe('Version label, or null when unset.'),
    description: z.string().nullable().describe('Version release note, or null when unset.'),
    isActive: z.boolean().describe('Whether this version is currently serving executions.'),
    createdAt: z
      .string()
      .describe('ISO 8601 timestamp when this version was created.')
      .meta({ format: 'date-time' }),
    state: deployedWorkflowStateSchema.describe(
      'Workflow graph saved with this deployment version. Sensitive values are redacted to null.'
    ),
  })
  .meta({
    id: 'WorkflowVersionDetail',
    title: 'Workflow version detail',
    description: 'A deployment version together with the workflow state it pins.',
  })
export type V2WorkflowVersionDetail = z.output<typeof v2WorkflowVersionDetailSchema>

export const v2ListWorkflowVersionsContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/workflows/[workflowId]/versions',
  params: v2WorkflowIdParamsSchema,
  query: v2ListWorkflowVersionsQuerySchema,
  response: {
    mode: 'json',
    schema: v2CursorListResponse(v2WorkflowVersionSchema),
  },
})

export const v2GetWorkflowVersionContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/workflows/[workflowId]/versions/[version]',
  query: noInputSchema,
  params: v2DeploymentVersionParamsSchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2WorkflowVersionDetailSchema),
  },
})

export const v2GetWorkflowDeploymentContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/workflows/[workflowId]/deployment',
  query: noInputSchema,
  params: v2WorkflowIdParamsSchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2WorkflowDeploymentSchema),
  },
})

export const v2DeployWorkflowContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/workflows/[workflowId]/deploy',
  query: noInputSchema,
  params: v2WorkflowIdParamsSchema,
  body: v1DeployWorkflowBodySchema
    .extend({
      name: v1DeployWorkflowBodySchema.shape.name.describe(
        'Optional label for the deployment version.'
      ),
      description: v1DeployWorkflowBodySchema.shape.description.describe(
        'Optional release note for the deployment version.'
      ),
    })
    .strict()
    .optional()
    .default({})
    .meta({
      id: 'DeployWorkflowRequest',
      title: 'Deploy workflow request',
      description: 'Optional metadata for the new deployment version.',
      examples: [
        { name: 'Escalation routing', description: 'Adds the priority escalation branch.' },
      ],
    }),
  response: {
    mode: 'json',
    schema: v2DataResponse(v2DeployWorkflowDataSchema),
  },
})

export const v2UndeployWorkflowContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/v2/workflows/[workflowId]/deploy',
  query: noInputSchema,
  params: v2WorkflowIdParamsSchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2UndeployWorkflowDataSchema),
  },
})

/**
 * Rollback carries a single optional field, and omitting it is a legitimate
 * request meaning "reactivate the version preceding the active one". A
 * stripping body schema therefore cannot distinguish an intentional omission
 * from a misspelled `version`, and silently performs the wrong rollback while
 * answering `200`. `.strict()` is what makes the two distinguishable, so it is
 * load-bearing here rather than hygiene.
 */
export const v2RollbackWorkflowContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/workflows/[workflowId]/rollback',
  query: noInputSchema,
  params: v2WorkflowIdParamsSchema,
  body: v1RollbackWorkflowBodySchema
    .extend({
      version: v1RollbackWorkflowBodySchema.shape.version.describe(
        'Deployment version to reactivate. Omit to select the previous active version.'
      ),
    })
    .strict()
    .optional()
    .default({})
    .meta({
      id: 'RollbackWorkflowRequest',
      title: 'Rollback workflow request',
      description: 'Optional deployment version to reactivate.',
      examples: [{ version: 2 }],
    }),
  response: {
    mode: 'json',
    schema: v2DataResponse(v2RollbackWorkflowDataSchema),
  },
})

/**
 * Version metadata as this surface publishes it. The label and release note are
 * the only mutable fields of a deployment version: the pinned graph is
 * immutable by construction, so a metadata write can never change what the
 * version executes.
 */
export const v2WorkflowVersionMetadataSchema = z
  .object({
    version: z
      .number()
      .int()
      .positive()
      .describe('Monotonically increasing deployment version number.'),
    name: z.string().nullable().describe('Version label, or null when unset.'),
    description: z.string().nullable().describe('Version release note, or null when unset.'),
  })
  .meta({
    id: 'WorkflowVersionMetadata',
    title: 'Workflow version metadata',
    description: 'Mutable label and release note of a deployment version.',
  })
export type V2WorkflowVersionMetadata = z.output<typeof v2WorkflowVersionMetadataSchema>

/**
 * Merge-patch shaped: an omitted key is unchanged, and `description: null`
 * clears the release note. `name` has no null form because a version label is
 * either set or absent and the column already stores absence as null — clearing
 * it is expressible, but only by the internal editor, which owns the empty
 * state. At least one key is required, because a body carrying neither is a
 * caller mistake that would otherwise answer `200` having changed nothing.
 */
export const v2UpdateWorkflowVersionBodySchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'name cannot be empty')
      .max(100, 'name must be 100 characters or less')
      .optional()
      .describe('New label for the deployment version.'),
    description: z
      .string()
      .trim()
      .max(50_000, 'description must be 50000 characters or less')
      .nullable()
      .optional()
      .describe('New release note for the deployment version, or null to clear it.'),
  })
  .strict()
  .superRefine((body, ctx) => {
    if (body.name === undefined && body.description === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['name'],
        message: 'At least one of name or description must be provided',
      })
    }
  })
  .meta({
    id: 'UpdateWorkflowVersionRequest',
    title: 'Update workflow version request',
    description: 'Merge-patch body for the mutable metadata of a deployment version.',
    examples: [{ name: 'Escalation routing', description: 'Adds the priority escalation branch.' }],
  })
export type V2UpdateWorkflowVersionBody = z.input<typeof v2UpdateWorkflowVersionBodySchema>

export const v2UpdateWorkflowVersionContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/v2/workflows/[workflowId]/versions/[version]',
  query: noInputSchema,
  params: v2DeploymentVersionParamsSchema,
  body: v2UpdateWorkflowVersionBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2WorkflowVersionMetadataSchema),
  },
})

/**
 * Activation names its target in the path, so the body carries nothing. It is
 * still declared — and still `.strict()` — so that a caller who sends the
 * rollback body by mistake is told, rather than silently activating the version
 * the path named.
 */
export const v2ActivateWorkflowVersionContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/workflows/[workflowId]/versions/[version]/activate',
  query: noInputSchema,
  params: v2DeploymentVersionParamsSchema,
  body: noInputSchema
    .optional()
    .default({})
    .meta({
      id: 'ActivateWorkflowVersionRequest',
      title: 'Activate workflow version request',
      description: 'No body. The version to promote is named by the request path.',
      examples: [{}],
    }),
  response: {
    mode: 'json',
    schema: v2DataResponse(v2ActivateWorkflowVersionDataSchema),
  },
})

/**
 * Revert result. `lastSaved` is the draft's new save timestamp, which is what a
 * collaborative editor reconciles against — the caller needs it to know its own
 * cached draft is stale.
 */
export const v2RevertWorkflowVersionDataSchema = z
  .object({
    id: z.string().describe('Unique workflow identifier.'),
    version: z
      .union([z.number().int().positive(), z.literal('active')])
      .describe('Deployment version loaded into the draft, or `active` for the live version.'),
    lastSaved: z
      .number()
      .int()
      .nonnegative()
      .describe('Epoch milliseconds at which the overwritten draft was saved.'),
  })
  .meta({
    id: 'RevertWorkflowVersionResult',
    title: 'Revert workflow version result',
    description: 'The draft after it was overwritten by a deployment version.',
  })
export type V2RevertWorkflowVersionData = z.output<typeof v2RevertWorkflowVersionDataSchema>

/**
 * `version` accepts the literal `active` in addition to a version number, so a
 * caller can discard draft edits and return to what is live without first
 * reading which version that is.
 */
export const v2RevertWorkflowVersionContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/workflows/[workflowId]/versions/[version]/revert',
  query: noInputSchema,
  params: v2DeploymentVersionOrActiveParamsSchema,
  body: noInputSchema
    .optional()
    .default({})
    .meta({
      id: 'RevertWorkflowVersionRequest',
      title: 'Revert workflow version request',
      description: 'No body. The version to load into the draft is named by the request path.',
      examples: [{}],
    }),
  response: {
    mode: 'json',
    schema: v2DataResponse(v2RevertWorkflowVersionDataSchema),
  },
})

export const v2WorkflowPublicApiSchema = z
  .object({
    id: z.string().describe('Unique workflow identifier.'),
    isPublicApi: z
      .boolean()
      .describe('Whether the deployed workflow accepts unauthenticated public API execution.'),
  })
  .meta({
    id: 'WorkflowPublicApiSettings',
    title: 'Workflow public API settings',
    description: 'Whether a deployed workflow is executable without an API key.',
  })
export type V2WorkflowPublicApiSettings = z.output<typeof v2WorkflowPublicApiSchema>

export const v2UpdateWorkflowPublicApiBodySchema = updatePublicApiBodySchema
  .extend({
    isPublicApi: updatePublicApiBodySchema.shape.isPublicApi.describe(
      'Whether the deployed workflow should accept unauthenticated public API execution.'
    ),
  })
  .strict()
  .meta({
    id: 'UpdateWorkflowPublicApiRequest',
    title: 'Update workflow public API request',
    description: 'Enable or disable unauthenticated public execution of the deployed workflow.',
    examples: [{ isPublicApi: true }],
  })
export type V2UpdateWorkflowPublicApiBody = z.input<typeof v2UpdateWorkflowPublicApiBodySchema>

export const v2UpdateWorkflowPublicApiContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/v2/workflows/[workflowId]/deployment',
  query: noInputSchema,
  params: v2WorkflowIdParamsSchema,
  body: v2UpdateWorkflowPublicApiBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2WorkflowPublicApiSchema),
  },
})

/**
 * Structured execution error — mirrors `WorkflowExecutionErrorCode` in
 * `@/executor/utils/errors` (duplicated literally: contracts are
 * client-importable and must not pull executor modules). APPEND-ONLY: callers
 * route on these instead of substring-matching messages.
 *
 * `OUTPUT_TOO_LARGE` was retired rather than kept for the append-only promise:
 * an oversize run response is not an in-band failure and never reached
 * classification, so the code was never emitted on any response. See
 * `WorkflowExecutionErrorCode` for the full reasoning; the oversize case is an
 * HTTP 413 carrying `workflow_response_too_large` in the error envelope.
 *
 * Block attribution is NOT uniform across the operations that carry this
 * object — see `blockId` below.
 */
export const v2ExecutionErrorSchema = z
  .object({
    message: z.string().describe('Human-readable workflow execution failure message.'),
    code: z
      .enum([
        'TIMEOUT',
        'CANCELLED',
        'USAGE_LIMIT_EXCEEDED',
        'INVALID_INPUT',
        'BLOCK_EXECUTION_FAILED',
        'CHILD_WORKFLOW_FAILED',
        'EXECUTION_FAILED',
      ])
      .describe(
        'Stable machine-readable execution failure code. `BLOCK_EXECUTION_FAILED` and `CHILD_WORKFLOW_FAILED` are reported only where block attribution is available; elsewhere a block-level failure is reported as `EXECUTION_FAILED`.'
      ),
    /**
     * Failing block, when attributable. Deliberately crosses the workspace boundary for shared/child workflows — the runId + block context is the reproducible handle a caller hands the workflow provider.
     *
     * Attribution is produced at execution time from the failing block's throw
     * site, so it reaches the caller only on the synchronous execute response.
     * The polled run resource and the resume response reclassify a persisted
     * error *string* — the log row keeps no structured error — so these three
     * fields are absent there and the code collapses to `EXECUTION_FAILED`.
     * That is a known asymmetry, documented rather than silently promised:
     * a caller that needs the failing block reads the run's trace spans, which
     * do carry `blockId`, `name`, and `type`.
     */
    blockId: z
      .string()
      .optional()
      .describe(
        'Identifier of the failing block. Present on the synchronous execute response only; the polled run resource and the resume response cannot attribute a block.'
      ),
    blockName: z
      .string()
      .optional()
      .describe(
        'Display name of the failing block. Present on the synchronous execute response only.'
      ),
    blockType: z
      .string()
      .optional()
      .describe(
        'Integration or block type that failed. Present on the synchronous execute response only.'
      ),
  })
  .meta({
    id: 'ExecutionError',
    title: 'Execution error',
    description: 'Structured in-band failure details for a workflow run.',
  })
export type V2ExecutionError = z.output<typeof v2ExecutionErrorSchema>

/**
 * That the execute options constrain each other, said once. Kept as one
 * exported string so the request-body description and the OpenAPI operation
 * description cannot drift from each other.
 *
 * It deliberately does not enumerate the combinations the route rejects: a
 * caller reads a constraint where it applies, so each lives on `async`,
 * `stream`, `executionTimeoutSeconds`, `includeThinking`, or `includeToolCalls`.
 */
export const EXECUTE_OPTION_CONSTRAINTS =
  'Input descriptions specify compatible modes; invalid combinations return `400`.'

export const v2WorkflowRunSelectionSchema = z.discriminatedUnion('source', [
  z
    .object({
      source: z.literal('deployment').describe('Execute the active deployed workflow state.'),
    })
    .strict(),
  z
    .object({
      source: z.literal('manual').describe('Execute the current saved workflow state manually.'),
      entry: z
        .discriminatedUnion('type', [
          z
            .object({
              type: z
                .literal('trigger')
                .describe('Enter the manual run through a runnable trigger.'),
              blockId: z
                .string()
                .min(1, 'run.entry.blockId cannot be empty')
                .optional()
                .describe(
                  'Runnable trigger block to enter through. Omit only when the saved workflow has exactly one runnable trigger.'
                ),
              useMockPayload: z
                .boolean()
                .optional()
                .describe(
                  "Use the selected trigger's server-derived mock payload. Cannot be combined with `input`."
                ),
            })
            .strict(),
          z
            .object({
              type: z
                .literal('block')
                .describe('Resume manual execution at a block using persisted upstream state.'),
              blockId: z
                .string()
                .min(1, 'run.entry.blockId cannot be empty')
                .describe('Saved workflow block at which manual execution should resume.'),
              sourceRunId: z
                .string()
                .min(1, 'run.entry.sourceRunId cannot be empty')
                .describe(
                  'Run ID supplying upstream block results when starting from a selected block.'
                ),
            })
            .strict(),
        ])
        .optional()
        .describe(
          'Manual entry mode. Omit to enter through the workflow trigger; a block entry requires an exact source run.'
        ),
    })
    .strict(),
])
export type V2WorkflowRunSelection = z.input<typeof v2WorkflowRunSelectionSchema>

/**
 * Strict public execute body. Async is body-selected (`async: true`) — v2 has
 * no `X-Execution-Mode`/`X-Stream-Response` headers. `run` selects the public
 * deployment/manual behavior, while internal executor facts (`triggerType`,
 * `useDraftState`, deployment pinning, and source snapshots) remain trusted
 * server-side options and are NEVER wire fields.
 *
 * The rejected option combinations are enforced by the route after parsing and
 * described on the fields they constrain; {@link EXECUTE_OPTION_CONSTRAINTS}
 * only tells a caller that the options constrain each other.
 */
export const v2ExecuteWorkflowBodySchema = z
  .object({
    input: z
      .record(z.string(), z.unknown().describe('Value supplied for one workflow input field.'))
      .optional()
      .describe('Workflow input keyed by the selected trigger input-field name.'),
    run: v2WorkflowRunSelectionSchema
      .optional()
      .describe(
        'Workflow state and entry point to execute. Omit for the active deployment. Manual execution requires OAuth or personal-key write access and supports synchronous or streamed runs only.'
      ),
    async: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        'Queue the run and return a 202 receipt when true. Requires an OAuth access token or API key, cannot be combined with `stream`, and rejects all streaming and output-shaping options (`selectedOutputs`, `includeThinking`, `includeToolCalls`, `includeFileBase64`, `base64MaxBytes`).'
      ),
    /**
     * An upper bound on the request, not the effective timeout: the server
     * applies `Math.min(planTimeout, requested)`, so a value above the account's
     * plan timeout silently yields the plan timeout. Bounded by the shared
     * `MAX_WORKFLOW_EXECUTION_TIMEOUT_SECONDS` rather than a local literal.
     */
    executionTimeoutSeconds: z
      .number()
      .int()
      .min(1)
      .max(MAX_WORKFLOW_EXECUTION_TIMEOUT_SECONDS)
      .optional()
      .describe(
        "Maximum duration of an asynchronous run, in seconds, capped by the plan's execution timeout. Requires `async: true`; otherwise returns `400`."
      ),
    stream: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        'Return Server-Sent Events instead of JSON when true. Cannot be combined with `async`.'
      ),
    selectedOutputs: z
      .array(z.string().min(1))
      .max(100)
      .optional()
      .describe(
        'Output references for streaming: `<blockName>.<outputPath>` or `<childWorkflowId>.<blockName>.<outputPath>`, using normalized block names. Child references apply to every invocation. Requires `stream: true` and rejects synchronous or async requests. Use `selectedOutputs` with Get Workflow Run to narrow an existing run.'
      ),
    includeThinking: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        'Include model reasoning events in an agent-event stream. Requires `stream: true` and the `X-Sim-Stream-Protocol: agent-events-v1` request header, and is rejected when `async` is true.'
      ),
    includeToolCalls: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        'Include tool-call events in an agent-event stream. Requires `stream: true` and the `X-Sim-Stream-Protocol: agent-events-v1` request header, and is rejected when `async` is true.'
      ),
    includeFileBase64: z
      .boolean()
      .optional()
      .describe('Inline eligible output files as base64 content. Rejected when `async` is true.'),
    /**
     * Caps inline base64 file hydration; bounded (v1 leaves it unbounded).
     * Shares the run-read ceiling so the two halves of the same round trip
     * cannot disagree about how much a caller may inline.
     */
    base64MaxBytes: z
      .number()
      .int()
      .positive('base64MaxBytes must be at least 1')
      .max(
        MAX_INLINE_MATERIALIZATION_BYTES,
        `base64MaxBytes cannot exceed ${MAX_INLINE_MATERIALIZATION_BYTES}`
      )
      .optional()
      .describe(
        'Maximum total bytes of file content to inline as base64, lowering but never raising the server limit of 16 MiB. Rejected when `async` is true.'
      ),
  })
  .strict()
  .meta({
    id: 'ExecuteWorkflowRequest',
    title: 'Execute workflow request',
    description: `Input, workflow-state selection, and execution-mode options. ${EXECUTE_OPTION_CONSTRAINTS}`,
    examples: [
      { input: { ticketId: 'ticket_123' } },
      { input: { ticketId: 'ticket_123' }, async: true },
      { input: { ticketId: 'ticket_123' }, stream: true },
      { run: { source: 'manual' } },
      {
        run: {
          source: 'manual',
          entry: { type: 'block', blockId: 'block_123', sourceRunId: 'run_123' },
        },
      },
    ],
  })
export type V2ExecuteWorkflowBody = z.input<typeof v2ExecuteWorkflowBodySchema>

/**
 * The run result resource. In-band run failures are `status: 'failed'`
 * with a structured `error` — never an HTTP error: **a `runId` means 200/202 +
 * `data`; no `runId` means the `v2Error` envelope.** The sync
 * timeout is `status:'failed'` + `error.code:'TIMEOUT'` (v1 returned 408).
 */
export const v2ExecuteWorkflowDataSchema = z
  .object({
    runId: v2WorkflowRunIdSchema,
    workflowId: z.string().describe('Workflow that produced the run.'),
    status: z
      .enum(['completed', 'failed', 'paused', 'cancelled'])
      .describe('Terminal or paused run status.'),
    output: z.unknown().describe('Workflow output, including partial output on failure.'),
    error: v2ExecutionErrorSchema
      .nullable()
      .describe('Structured execution failure, or null when none occurred.'),
    startedAt: z
      .string()
      .optional()
      .describe('ISO 8601 timestamp when execution started.')
      .meta({ format: 'date-time' }),
    endedAt: z
      .string()
      .optional()
      .describe('ISO 8601 timestamp when execution ended.')
      .meta({ format: 'date-time' }),
    durationMs: z.number().nonnegative().optional().describe('Execution duration in milliseconds.'),
  })
  .meta({
    id: 'WorkflowRunResult',
    title: 'Workflow run result',
    description:
      'Synchronous workflow run output and in-band execution status. Run failures are reported in band, not as HTTP errors — a run that exceeds its execution timeout returns HTTP 200 with `status: "failed"` and `error.code: "TIMEOUT"`, so branch on `status`.',
  })
export type V2ExecuteWorkflowData = z.output<typeof v2ExecuteWorkflowDataSchema>

/** 202 receipt for `async: true` — poll `statusUrl` (the v2 runs resource). */
export const v2ExecuteWorkflowQueuedSchema = z
  .object({
    runId: v2WorkflowRunIdSchema,
    statusUrl: z.string().url().describe('Absolute URL of the workflow run resource.'),
  })
  .meta({
    id: 'QueuedWorkflowRun',
    title: 'Queued workflow run',
    description: 'Receipt returned when a workflow run is queued.',
  })
export type V2ExecuteWorkflowQueued = z.output<typeof v2ExecuteWorkflowQueuedSchema>

export const v2ExecuteWorkflowSyncResponseSchema = v2DataResponse(v2ExecuteWorkflowDataSchema)
export const v2ExecuteWorkflowQueuedResponseSchema = v2DataResponse(v2ExecuteWorkflowQueuedSchema)

export const v2ExecuteWorkflowSuccessSchema = z
  .union([v2ExecuteWorkflowSyncResponseSchema, v2ExecuteWorkflowQueuedResponseSchema])
  .meta({
    id: 'ExecuteWorkflowResponse',
    title: 'Execute workflow response',
    description: 'A completed synchronous run or an asynchronous queue receipt.',
  })

export const v2ExecuteWorkflowContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/workflows/[workflowId]/execute',
  query: noInputSchema,
  params: v2WorkflowIdParamsSchema,
  headers: v2ExecuteWorkflowHeadersSchema,
  body: v2ExecuteWorkflowBodySchema,
  response: {
    mode: 'json',
    schema: v2ExecuteWorkflowSuccessSchema,
    status: [200, 202],
    statusSchemas: {
      200: v2ExecuteWorkflowSyncResponseSchema,
      202: v2ExecuteWorkflowQueuedResponseSchema,
    },
  },
})

/** Resume input is scoped to one pause context on the parent run. */
export const v2ResumeWorkflowBodySchema = z
  .object({
    contextId: z
      .string()
      .min(1, 'contextId cannot be empty')
      .describe('Human-in-the-loop pause-context identifier.'),
    input: z.unknown().optional().describe('Input supplied to the paused workflow block.'),
  })
  .strict()
  .meta({
    id: 'ResumeWorkflowRequest',
    title: 'Resume workflow request',
    description: 'Pause context and optional input used to resume a workflow run.',
    examples: [{ contextId: 'ctx_123', input: { approved: true } }],
  })
export type V2ResumeWorkflowBody = z.input<typeof v2ResumeWorkflowBodySchema>

export const v2ResumeWorkflowQueuedSchema = v2ExecuteWorkflowQueuedSchema
  .extend({
    queuePosition: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('Current queue position, when available.'),
  })
  .meta({
    id: 'QueuedWorkflowResume',
    title: 'Queued workflow resume',
    description: 'Receipt returned when a resumed workflow attempt is queued.',
  })
export type V2ResumeWorkflowQueued = z.output<typeof v2ResumeWorkflowQueuedSchema>

export const v2ResumeWorkflowSyncResponseSchema = v2DataResponse(v2ExecuteWorkflowDataSchema)
export const v2ResumeWorkflowQueuedResponseSchema = v2DataResponse(v2ResumeWorkflowQueuedSchema)

export const v2ResumeWorkflowResponseSchema = z
  .union([v2ResumeWorkflowSyncResponseSchema, v2ResumeWorkflowQueuedResponseSchema])
  .meta({
    id: 'ResumeWorkflowResponse',
    title: 'Resume workflow response',
    description: 'A synchronous resumed run or an asynchronous queue receipt.',
  })
export type V2ResumeWorkflowResponse = z.output<typeof v2ResumeWorkflowResponseSchema>

export const v2ResumeWorkflowContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/workflows/[workflowId]/runs/[runId]/resume',
  query: noInputSchema,
  params: v2WorkflowRunParamsSchema,
  body: v2ResumeWorkflowBodySchema,
  response: {
    mode: 'json',
    schema: v2ResumeWorkflowResponseSchema,
    status: [200, 202],
    statusSchemas: {
      200: v2ResumeWorkflowSyncResponseSchema,
      202: v2ResumeWorkflowQueuedResponseSchema,
    },
  },
})

const RUN_STATUS_DESCRIPTION =
  "Current or terminal run status. `redacting` is transient, reported while a finished run's output is being scrubbed. `paused` means the run is waiting to be resumed — either held at a human-in-the-loop pause point, or left paused by a resume attempt that did not complete. Only the single-run response distinguishes the two, through `paused.automaticResumeWaitingReason`."

/**
 * The list projection passes `workflow_execution_logs.status` through except where it
 * overlays `paused` for a run holding a `paused` or `partially_resumed` row in
 * `paused_executions` — so a reported `paused` is either that overlay or the persisted
 * value a failed resume attempt left behind. Both branches land in the persisted set, so the reported enum is
 * derived from it — a value missing here fails the response parse, and because list
 * validation is whole-page one such row turns an entire page into a 500. `queued` is not
 * reportable: a run still only in the job queue has no log row to list.
 */
export const v2WorkflowRunListStatusValueSchema = z
  .enum(PERSISTED_WORKFLOW_EXECUTION_STATUSES)
  .describe(RUN_STATUS_DESCRIPTION)

/**
 * The single-run read additionally consults the async job queue by deterministic job id,
 * so a run accepted but not yet started reports `queued` rather than 404.
 */
export const v2WorkflowRunStatusValueSchema = z
  .enum([...PERSISTED_WORKFLOW_EXECUTION_STATUSES, 'queued'])
  .describe(RUN_STATUS_DESCRIPTION)

/**
 * Statuses accepted by the run-list `status` filter. Narrower than the reported set on
 * purpose: the filter compares against the same projection, and `redacting` is a
 * sub-second window nothing can usefully page through.
 */
export const v2WorkflowRunStatusFilterSchema = z.enum([
  'pending',
  'running',
  'completed',
  'failed',
  'cancelled',
  'paused',
])

export const v2ListWorkflowRunsQuerySchema = z
  .object({
    status: v2WorkflowRunStatusFilterSchema.optional().describe('Filter by run status.'),
    trigger: z
      .string()
      .min(1, 'trigger cannot be empty')
      .optional()
      .describe('Filter by trigger type.'),
    startDate: v2RunWindowBoundSchema('startDate').optional(),
    endDate: v2RunWindowBoundSchema('endDate').optional(),
    ...v2PaginationFields({ description: 'Maximum workflow runs to return per page.' }),
    /**
     * Deliberate deviation from the v2 `sortBy` + `sortOrder` convention. Runs
     * have exactly one sortable column (start time), so there is no `sortBy` to
     * pair with, and the run cursor is a keyset minted over `order`. Renaming or
     * aliasing the param would require a route change and would introduce a
     * second spelling with undefined precedence when both are sent — so the
     * deviation is documented rather than papered over.
     *
     * Shared with `GET /logs` so the two spell the enum the same way in the
     * generated specs.
     */
    order: v2RunOrderSchema('run'),
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
  .meta({
    id: 'ListWorkflowRunsQuery',
    title: 'List workflow runs query',
    description:
      'Status, trigger, date-window, ordering, and pagination filters for workflow runs. Ordering uses the single `order` param rather than the v2 `sortBy` + `sortOrder` pair, because runs are sortable only by start time.',
  })

export type V2ListWorkflowRunsQuery = z.output<typeof v2ListWorkflowRunsQuerySchema>

export const v2WorkflowRunListItemSchema = z
  .object({
    runId: v2WorkflowRunIdSchema,
    workflowId: z.string().describe('Workflow that produced the run.'),
    status: v2WorkflowRunListStatusValueSchema,
    trigger: z.string().describe('Trigger type that started the run.'),
    startedAt: z
      .string()
      .describe('ISO 8601 timestamp when the run started.')
      .meta({ format: 'date-time' }),
    endedAt: z
      .string()
      .nullable()
      .describe('ISO 8601 timestamp when the run ended, or null while active.')
      .meta({ format: 'date-time' }),
    durationMs: z
      .number()
      .nullable()
      .describe('Run duration in milliseconds, or null while active.'),
    cost: z
      .object({ total: z.number().describe('Total credits consumed by the run.') })
      .nullable()
      .describe('Credit cost, or null when unavailable.'),
  })
  .meta({
    id: 'WorkflowRunListItem',
    title: 'Workflow run summary',
    description: 'Summary of a recorded workflow run.',
  })

export type V2WorkflowRunListItem = z.output<typeof v2WorkflowRunListItemSchema>

export const v2ListWorkflowRunsContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/workflows/[workflowId]/runs',
  params: v2WorkflowIdParamsSchema,
  query: v2ListWorkflowRunsQuerySchema,
  response: {
    mode: 'json',
    schema: v2CursorListResponse(v2WorkflowRunListItemSchema),
  },
})

/**
 * One file a run produced.
 *
 * The storage `key` is deliberately absent: a caller addresses a run file by
 * `id` at `downloadPath`, and the key is re-derived server side from the run's
 * recording on every request, so a request can never name bytes the run did not
 * produce. No expiry is published either — the recording carries none, and a
 * fabricated one would be worse than the honest advice that execution objects
 * are not retained indefinitely.
 */
export const v2RunFileSchema = z
  .object({
    id: z.string().describe('Identifier to address this file by on the download endpoint.'),
    name: z.string().describe('File name, including its extension.'),
    size: z.number().int().nonnegative().describe('File size in bytes.'),
    type: z.string().describe('MIME type recorded for the file.'),
    downloadPath: z
      .string()
      .describe("Path to fetch this file's bytes from, relative to the API host."),
    base64: z
      .string()
      .nullable()
      .describe(
        'Base64-encoded contents when `includeFileBase64` was requested and the file fits the inline ceiling, otherwise null.'
      ),
  })
  .strict()
  .meta({
    id: 'V2RunFile',
    title: 'Workflow run file',
    description: 'A file produced by a workflow run.',
  })
export type V2RunFile = z.output<typeof v2RunFileSchema>

/**
 * The polled run resource. `queued` is backfilled from the async job
 * queue before the worker writes the durable log row — v1's jobs endpoint 404
 * window doesn't exist here. `error` is the same *shape* the execute response
 * carries, but not the same content: this resource reclassifies the persisted
 * error string, so it never attributes a block. See `v2ExecutionErrorSchema`.
 */
export const v2WorkflowRunStatusSchema = z
  .object({
    runId: v2WorkflowRunIdSchema,
    workflowId: z.string().describe('Workflow that produced the run.'),
    status: v2WorkflowRunStatusValueSchema,
    /**
     * Kept nullable on the wire while never being null in practice: every
     * projection this resource has — the queued job, the queued resume, and the
     * durable log row — backfills both fields (`api` and the job's creation time
     * when the run is not yet recorded), so no caller has observed a null here.
     * The nullability is the schema's tolerance for a future projection, not a
     * state a caller needs to branch on, which is why neither description
     * promises a null that never arrives.
     */
    trigger: z
      .string()
      .nullable()
      .describe(
        'Trigger type that started the run. Backfilled as `api` for a run that is still queued, so it is populated from the first poll.'
      ),
    startedAt: z
      .string()
      .nullable()
      .describe(
        'ISO 8601 start timestamp. A queued run reports the time it was enqueued, so it is populated from the first poll.'
      )
      .meta({ format: 'date-time' }),
    endedAt: z
      .string()
      .nullable()
      .describe('ISO 8601 end timestamp, or null while nonterminal.')
      .meta({ format: 'date-time' }),
    durationMs: z
      .number()
      .nullable()
      .describe('Run duration in milliseconds, or null while active.'),
    paused: workflowExecutionPausedDetailSchema
      .omit({ pausedExecutionId: true })
      .nullable()
      .describe('Current pause details, or null when the run is not paused.'),
    cost: z
      .object({ total: z.number().describe('Total credits consumed by the run.') })
      .nullable()
      .describe('Credit cost, or null when unavailable.'),
    error: v2ExecutionErrorSchema
      .nullable()
      .describe(
        'Structured execution failure, or null when none occurred. Reclassified from the persisted error message, so `blockId`/`blockName`/`blockType` are absent and a block-level failure reports `EXECUTION_FAILED` here even when the same run reported `BLOCK_EXECUTION_FAILED` on its synchronous execute response.'
      ),
    /** Populated only with `includeOutput=true` on completed runs. */
    output: z
      .unknown()
      .describe('Final workflow output value.')
      .nullable()
      .describe('Final workflow output when requested, otherwise null.'),
    blockOutputs: z
      .record(z.string(), z.unknown().describe('Output value produced by one workflow block.'))
      .nullable()
      .describe(
        'Outputs of the blocks named by `selectedOutputs`, or null when none were requested. Gated by `selectedOutputs` alone — `includeOutput` governs `output` only.'
      ),
    files: z
      .array(v2RunFileSchema)
      .nullable()
      .describe(
        'Files this run produced, or null when `includeOutput` is false. Matches the nullability of `output`.'
      ),
  })
  .meta({
    id: 'WorkflowRunStatus',
    title: 'Workflow run status',
    description: 'Detailed current state of a workflow run.',
  })
export type V2WorkflowRunStatus = z.output<typeof v2WorkflowRunStatusSchema>

export const v2DownloadRunFileParamsSchema = z
  .object({
    workflowId: z.string().min(1, 'Invalid workflow ID').describe('Unique workflow identifier.'),
    runId: v2WorkflowRunIdSchema.describe('Unique workflow run identifier.'),
    fileId: z
      .string()
      .min(1, 'fileId cannot be empty')
      .max(256, 'fileId is too long')
      .describe('Identifier of a file the run produced, as reported by the run resource.'),
  })
  .meta({
    id: 'DownloadRunFileParams',
    title: 'Run file path parameters',
    description: 'Workflow, run, and run-produced file selected by the request path.',
  })
export type V2DownloadRunFileParams = z.input<typeof v2DownloadRunFileParamsSchema>

/**
 * Downloads one file a run produced.
 *
 * The file is addressed by the id the run itself reported; a storage key is
 * never accepted from the request, so this endpoint cannot be pointed at bytes
 * the run did not produce.
 */
export const v2DownloadRunFileContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/workflows/[workflowId]/runs/[runId]/files/[fileId]',
  params: v2DownloadRunFileParamsSchema,
  query: noInputSchema,
  response: {
    mode: 'binary',
  },
})

export const v2GetWorkflowRunContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/workflows/[workflowId]/runs/[runId]',
  params: v2WorkflowRunParamsSchema,
  query: workflowExecutionStatusQuerySchema
    .extend({
      /**
       * Declared with the shared boolean flag rather than reused from the
       * internal shape, which spells it as a `'true'`/`'false'` string enum
       * while every other v2 boolean query param is a real boolean. The shared
       * schema still accepts both strings, so `?includeOutput=true` keeps
       * working identically; it only widens what parses.
       */
      includeOutput: booleanQueryFlagSchema
        .describe(
          'Include the final workflow output when true. It does not gate `blockOutputs`, which `selectedOutputs` selects on its own.'
        )
        .optional()
        .default(false),
      /**
       * Block *ids*, unlike the execute request's `selectedOutputs`, which also
       * accepts `BlockName.path` and resolves it against the live workflow. This
       * resource reads a recorded run and never loads the workflow's blocks, so
       * a name has no id to resolve to and is refused rather than silently
       * selecting nothing.
       */
      selectedOutputs: workflowExecutionStatusQuerySchema.shape.selectedOutputs.describe(
        'Comma-separated block output references to include, as `blockId` or `blockId.path`. Block *names* are not resolved here — unlike the execute request, this resource reads a recorded run and matches ids only, so a selector that is not headed by a block id answers `400` instead of an empty `blockOutputs`.'
      ),
      /**
       * Allowed here but not on the async execute request, whose rejection is
       * correct: at submit time the run has not happened, so there is nothing to
       * inline. Reading a finished run is the first moment the question means
       * anything.
       */
      includeFileBase64: booleanQueryFlagSchema
        .describe(
          "Inline each produced file's bytes as base64. Requires `includeOutput`. A file above the inline ceiling answers `413` naming its download path; fetch large files from `downloadPath` instead."
        )
        .optional()
        .default(false),
      base64MaxBytes: z.coerce
        .number()
        .int()
        .min(1, 'base64MaxBytes must be at least 1')
        .max(
          MAX_INLINE_MATERIALIZATION_BYTES,
          `base64MaxBytes cannot exceed ${MAX_INLINE_MATERIALIZATION_BYTES}`
        )
        .optional()
        .describe(
          'Per-file inline ceiling, lowering but never raising the server limit of 16 MiB.'
        ),
    })
    .strict()
    /**
     * `includeFileBase64` is documented as requiring `includeOutput`, and the
     * read honours that: file projection happens inside the `includeOutput`
     * branch alone. Nothing enforced it, so asking for base64 without output
     * parsed, was accepted, and was then dropped — the response came back `200`
     * carrying no files and nothing to say why. `base64MaxBytes` rides on the
     * same projection and was ignored the same way. Rejecting names the missing
     * flag instead, matching `GET /billing/logs`, which refuses a window bound
     * its period will not read rather than answering over a different one.
     */
    .superRefine((query, ctx) => {
      if (query.includeOutput) return
      for (const field of ['includeFileBase64', 'base64MaxBytes'] as const) {
        if (query[field] === undefined || query[field] === false) continue
        ctx.addIssue({
          code: 'custom',
          message: `${field} is only accepted with includeOutput=true; without it the run's files are never projected`,
          path: [field],
        })
      }
    })
    .meta({
      id: 'GetWorkflowRunQuery',
      title: 'Get workflow run query',
      description: 'Controls whether the run response includes output data.',
    }),
  response: {
    mode: 'json',
    schema: v2DataResponse(v2WorkflowRunStatusSchema),
  },
})

export const v2CancelWorkflowRunDataSchema = z
  .object({
    success: z.boolean().describe('Whether cancellation was accepted.'),
    runId: v2WorkflowRunIdSchema,
    redisAvailable: z
      .boolean()
      .describe('Whether the distributed cancellation channel was available.'),
    durablyRecorded: z
      .boolean()
      .describe(
        'Whether this request durably recorded a cancellation. Always false for a run that was already terminal, where the request is satisfied but nothing was written.'
      ),
    locallyAborted: z.boolean().describe('Whether an in-process execution was aborted.'),
    pausedCancelled: z.boolean().describe('Whether a paused execution was cancelled.'),
    reason: cancelWorkflowExecutionReasonSchema
      .optional()
      .describe(
        'Machine-readable cancellation outcome, present on every cancellation including full successes. `recorded` and `queue_cancelled` are successful cancellation values. `already_cancelled`, `already_completed`, and `already_failed` mean the run had already reached that terminal state, so nothing was cancelled and `durablyRecorded` is false. The remaining values identify a degraded or incomplete cancellation step.'
      ),
  })
  .meta({
    id: 'CancelWorkflowRunResult',
    title: 'Cancel workflow run result',
    description:
      'Outcome of a workflow run cancellation request. Cancellation is best-effort: a run already in a terminal state succeeds with no effect, reported as `durablyRecorded: false` with an `already_*` reason naming the state observed.',
  })
export type V2CancelWorkflowRunData = z.output<typeof v2CancelWorkflowRunDataSchema>

export const v2CancelWorkflowRunContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/workflows/[workflowId]/runs/[runId]/cancel',
  query: noInputSchema,
  params: v2WorkflowRunParamsSchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2CancelWorkflowRunDataSchema),
  },
})

export const v2WorkflowExportPayloadSchema = v1WorkflowExportPayloadSchema
  .extend({
    version: v1WorkflowExportPayloadSchema.shape.version.describe(
      'Workflow export format version.'
    ),
    exportedAt: v1WorkflowExportPayloadSchema.shape.exportedAt
      .describe('ISO 8601 timestamp when the export was created.')
      .meta({ format: 'date-time' }),
    workflow: v1WorkflowExportPayloadSchema.shape.workflow
      .omit({ folderId: true })
      .extend({
        id: v1WorkflowExportPayloadSchema.shape.workflow.shape.id.describe(
          'Identifier of the source workflow.'
        ),
        name: v1WorkflowExportPayloadSchema.shape.workflow.shape.name.describe(
          'Name of the exported workflow.'
        ),
        description: v1WorkflowExportPayloadSchema.shape.workflow.shape.description.describe(
          'Description of the exported workflow, or null when unset.'
        ),
        workspaceId: v1WorkflowExportPayloadSchema.shape.workflow.shape.workspaceId.describe(
          'Identifier of the source workspace, or null for legacy exports.'
        ),
        folderPath: v2FolderPathSchema.describe(
          'Canonical containing-folder path; `/` is the workspace root.'
        ),
      })
      .describe('Source workflow metadata.'),
    state: v1WorkflowExportPayloadSchema.shape.state.meta({
      type: 'object',
      properties: undefined,
      required: undefined,
      additionalProperties: true,
      description:
        'Secret-sanitized workflow graph, edges, loops, parallels, metadata, and variables.',
    }),
  })
  .meta({
    id: 'WorkflowExportPayload',
    title: 'Workflow export payload',
    description:
      'Portable, secret-sanitized workflow export. Workspace-scoped bindings must be selected again after import.',
  })

export const v2ImportWorkflowBodySchema = v1ImportWorkflowBodySchema
  .omit({ folderId: true, name: true, description: true })
  .extend({
    workspaceId: v1ImportWorkflowBodySchema.shape.workspaceId.describe(
      'Workspace in which to import the workflow.'
    ),
    workflow: v1ImportWorkflowBodySchema.shape.workflow.meta({
      description:
        'Workflow export object, bare workflow state, or JSON string containing either form.',
      anyOf: [
        {
          type: 'string',
          minLength: 1,
          description: 'JSON string containing a workflow export object or bare workflow state.',
        },
        {
          type: 'object',
          additionalProperties: true,
          description: 'Workflow export object or bare workflow state.',
        },
      ],
    }),
    folderPath: v2FolderPathInputSchema
      .optional()
      .describe('Destination folder path; omit for the workspace root.'),
    name: z
      .string()
      .min(1, 'name cannot be empty')
      .max(
        V1_IMPORT_NAME_MAX_LENGTH,
        `name must be at most ${V1_IMPORT_NAME_MAX_LENGTH} characters`
      )
      .optional()
      .describe('Override for the imported workflow name.'),
    description: z
      .string()
      .max(
        V1_IMPORT_DESCRIPTION_MAX_LENGTH,
        `description must be at most ${V1_IMPORT_DESCRIPTION_MAX_LENGTH} characters`
      )
      .optional()
      .describe('Override for the imported workflow description.'),
  })
  .strict()
  .meta({
    id: 'ImportWorkflowRequest',
    title: 'Import workflow request',
    description: 'Portable workflow data and destination metadata for an import.',
    examples: [
      {
        workspaceId: 'a91c4b2e-6d3f-4e8a-b5c7-0d9e2f1a8c64',
        folderPath: '/Operations',
        workflow: { blocks: {}, edges: [] },
      },
    ],
  })

export const v2ImportWorkflowDataSchema = z
  .object({
    id: z.string().describe('Identifier of the imported workflow.'),
    name: z.string().describe('Imported workflow name.'),
    description: z.string().nullable().describe('Imported workflow description.'),
    workspaceId: z.string().describe('Workspace that owns the imported workflow.'),
    folderPath: v2FolderPathSchema.describe('Canonical containing-folder path.'),
    createdAt: z
      .string()
      .describe('ISO 8601 timestamp when the workflow was imported.')
      .meta({ format: 'date-time' }),
    updatedAt: z
      .string()
      .describe('ISO 8601 timestamp when the workflow was last updated.')
      .meta({ format: 'date-time' }),
  })
  .meta({
    id: 'ImportedWorkflow',
    title: 'Imported workflow',
    description: 'Workflow created by an import operation.',
  })

export const v2ExportWorkflowContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/workflows/[workflowId]/export',
  query: noInputSchema,
  params: v2WorkflowIdParamsSchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2WorkflowExportPayloadSchema),
  },
})

export const v2ImportWorkflowContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/workflows/import',
  query: noInputSchema,
  body: v2ImportWorkflowBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2ImportWorkflowDataSchema),
    status: 201,
  },
})

/**
 * Ceilings on a graph a caller may push. Neither the internal `workflowStateSchema`
 * nor the normalized tables bound these, so without them a single request can
 * ask the persistence layer to write an unbounded number of rows. Both sit an
 * order of magnitude above the largest workflow observed in production.
 */
export const MAX_WORKFLOW_GRAPH_BLOCKS = 2000
export const MAX_WORKFLOW_GRAPH_EDGES = 10_000
/** Ceiling on one `POST /operations` batch. */
export const MAX_WORKFLOW_EDIT_OPERATIONS = 200
/** Ceiling on the complete tool list assigned to one Agent block. */
export const MAX_AGENT_TOOLS_PER_BLOCK = 100
/** Ceiling on one `PATCH /variables` batch; mirrors the application use case's own cap. */
export const MAX_WORKFLOW_VARIABLE_OPERATIONS = 100
/** Ceiling on one bulk move; mirrors the application use case's own cap. */
export const MAX_WORKFLOW_BULK_MOVES = 100

const v2WorkflowBlockPositionSchema = z
  .object({
    x: z.number().describe('Canvas x coordinate.'),
    y: z.number().describe('Canvas y coordinate.'),
  })
  .describe('Canvas coordinates of a block.')

const v2WorkflowBlockDataSchema = z
  .object({
    parentId: z.string().optional().describe('Identifier of the containing loop or parallel.'),
    extent: z.literal('parent').optional().describe('Constrains the block to its parent bounds.'),
    width: z.number().optional().describe('Rendered container width.'),
    height: z.number().optional().describe('Rendered container height.'),
    collection: z
      .unknown()
      .optional()
      .describe('Items a forEach loop or collection parallel iterates.'),
    count: z.number().optional().describe('Iteration count for a `for` loop or count parallel.'),
    loopType: z
      .enum(['for', 'forEach', 'while', 'doWhile'])
      .optional()
      .describe('Loop container kind.'),
    whileCondition: z.string().optional().describe('Condition expression for a `while` loop.'),
    doWhileCondition: z.string().optional().describe('Condition expression for a `doWhile` loop.'),
    parallelType: z.enum(['collection', 'count']).optional().describe('Parallel container kind.'),
    batchSize: z.number().optional().describe('Maximum concurrent branches of a parallel.'),
    type: z.string().optional().describe('Container subtype.'),
    canonicalModes: z
      .record(z.string(), z.enum(['basic', 'advanced']))
      .optional()
      .describe('Per-field editing mode, keyed by canonical parameter id.'),
  })
  .describe('Container and layout metadata carried by a block.')

const v2WorkflowSubBlockSchema = z
  .object({
    id: z.string().min(1, 'subBlock id cannot be empty').describe('Sub-block identifier.'),
    type: z.string().min(1, 'subBlock type cannot be empty').describe('Sub-block input type.'),
    value: z.unknown().describe('Configured value; shape depends on the sub-block type.'),
  })
  .describe('One configurable input on a block.')

const v2WorkflowBlockRetrySchema = z
  .object({
    enabled: z.boolean().describe('Whether the block retries on failure.'),
    maxTries: z
      .number()
      .int()
      .min(BLOCK_RETRY_MIN_TRIES, `maxTries must be at least ${BLOCK_RETRY_MIN_TRIES}`)
      .max(BLOCK_RETRY_MAX_TRIES, `maxTries cannot exceed ${BLOCK_RETRY_MAX_TRIES}`)
      .describe('Total attempts, including the first.'),
    waitBetweenTriesMs: z
      .number()
      .int()
      .min(BLOCK_RETRY_MIN_WAIT_MS, 'waitBetweenTriesMs cannot be negative')
      .max(BLOCK_RETRY_MAX_WAIT_MS, `waitBetweenTriesMs cannot exceed ${BLOCK_RETRY_MAX_WAIT_MS}ms`)
      .describe('Delay between attempts, in milliseconds.'),
  })
  .describe('Per-block retry configuration.')

/**
 * `stored` relaxes exactly the assertions the column cannot support, for the
 * same reason {@link workflowVariableSchema} does.
 *
 * `workflow_blocks.name` and `.type` are bare `text()` (packages/db/schema.ts),
 * and the realtime rename op accepts `z.string()`
 * (packages/realtime-protocol/src/schemas.ts), so nothing on any write path
 * holds a stored block to these bounds. Asserting them on the way out turned a
 * block renamed past 255 characters on the canvas into a `500` on
 * `GET /workflows/{workflowId}/state` — and because `PUT /state` needs that
 * round trip, the workflow became unreadable *and* unrepairable over v2.
 *
 * `input` keeps them: a write is the moment the bounds can still be honoured.
 */
function workflowBlockSchema(id: string, mode: 'input' | 'stored' = 'input') {
  const blockName =
    mode === 'input'
      ? z.string().min(1, 'block name cannot be empty').max(255, 'block name is too long')
      : z.string()
  const blockType = mode === 'input' ? z.string().min(1, 'block type cannot be empty') : z.string()
  return z
    .object({
      id: z
        .string()
        .min(1, 'block id cannot be empty')
        .describe('Block identifier, unique within the workflow.'),
      type: blockType.describe('Registered block type.'),
      name: blockName.describe('Block display name; must be unique within the workflow.'),
      position: v2WorkflowBlockPositionSchema,
      subBlocks: z
        .record(z.string(), v2WorkflowSubBlockSchema)
        .describe('Configured inputs keyed by sub-block id.'),
      outputs: z
        .record(
          z.string(),
          z.unknown().describe('Declared shape of one output; depends on the block type.')
        )
        .describe('Declared output shape keyed by output name.'),
      enabled: z.boolean().describe('Whether the block runs.'),
      horizontalHandles: z
        .boolean()
        .optional()
        .describe('Whether edge handles render horizontally.'),
      height: z.number().optional().describe('Rendered block height.'),
      advancedMode: z
        .boolean()
        .optional()
        .describe('Whether the block is edited in advanced mode.'),
      errorEnabled: z.boolean().optional().describe('Whether the block exposes an error branch.'),
      retry: v2WorkflowBlockRetrySchema.optional(),
      triggerMode: z
        .boolean()
        .optional()
        .describe('Whether the block acts as the workflow trigger.'),
      data: v2WorkflowBlockDataSchema.optional(),
      locked: z.boolean().optional().describe('Whether the block is locked against edits.'),
    })
    .meta({
      id,
      title: 'Workflow block',
      description: 'One node of a workflow graph and its configuration.',
    })
}

function workflowEdgeSchema(id: string) {
  return z
    .object({
      id: z
        .string()
        .min(1, 'edge id cannot be empty')
        .describe('Edge identifier, unique within the workflow.'),
      source: z.string().min(1, 'edge source cannot be empty').describe('Source block id.'),
      target: z.string().min(1, 'edge target cannot be empty').describe('Target block id.'),
      sourceHandle: z.string().nullish().describe('Source port, or null for the block default.'),
      targetHandle: z.string().nullish().describe('Target port, or null for the block default.'),
      type: z.string().optional().describe('Edge renderer type.'),
    })
    .meta({ id, title: 'Workflow edge', description: 'A directed connection between two blocks.' })
}

function workflowLoopSchema(id: string) {
  return z
    .object({
      id: z.string().describe('Loop container identifier; equal to the loop block id.'),
      nodes: z.array(z.string()).describe('Block ids inside the loop.'),
      iterations: z.number().describe('Resolved iteration count.'),
      loopType: z.enum(['for', 'forEach', 'while', 'doWhile']).describe('Loop kind.'),
      forEachItems: z
        .union([
          z.array(z.unknown().describe('One item the loop iterates.')),
          z.record(z.string(), z.unknown().describe('One item the loop iterates.')),
          z.string(),
        ])
        .optional()
        .describe('Items a forEach loop iterates, or the expression producing them.'),
      whileCondition: z.string().optional().describe('Condition expression for a `while` loop.'),
      doWhileCondition: z
        .string()
        .optional()
        .describe('Condition expression for a `doWhile` loop.'),
      enabled: z.boolean().optional().describe('Whether the loop runs.'),
      locked: z.boolean().optional().describe('Whether the loop is locked against edits.'),
    })
    .meta({
      id,
      title: 'Workflow loop',
      description: 'A loop container derived from the workflow blocks.',
    })
}

function workflowParallelSchema(id: string) {
  return z
    .object({
      id: z.string().describe('Parallel container identifier; equal to the parallel block id.'),
      nodes: z.array(z.string()).describe('Block ids inside the parallel.'),
      distribution: z
        .union([
          z.array(z.unknown().describe('One item distributed to a branch.')),
          z.record(z.string(), z.unknown().describe('One item distributed to a branch.')),
          z.string(),
        ])
        .optional()
        .describe('Items distributed across branches, or the expression producing them.'),
      count: z.number().optional().describe('Fixed branch count.'),
      parallelType: z.enum(['count', 'collection']).optional().describe('Parallel kind.'),
      batchSize: z.number().optional().describe('Maximum concurrent branches.'),
      enabled: z.boolean().optional().describe('Whether the parallel runs.'),
      locked: z.boolean().optional().describe('Whether the parallel is locked against edits.'),
    })
    .meta({
      id,
      title: 'Workflow parallel',
      description: 'A parallel container derived from the workflow blocks.',
    })
}

/**
 * A workflow variable on the graph surface.
 *
 * Deliberately carries no `workflowId`: the internal read stamps one for the
 * client's cross-workflow variables store, and on this surface the path already
 * names the workflow.
 */
const WORKFLOW_VARIABLE_TYPES = ['string', 'number', 'boolean', 'object', 'array', 'plain'] as const

/**
 * `stored` relaxes exactly the assertions the column cannot support.
 *
 * A response schema is parsed on the way out, so every bound it declares is a
 * claim about data already written — and nothing on any write path enforces
 * these two. The realtime `variable.add` op accepts `type: z.any()`, the Copilot
 * file materializer persists `variable.type || 'string'` for any string, and the
 * variables parser stores `name` verbatim including `''`. Declaring the input
 * bounds on the read would turn a workflow that exists into a 500 on the one
 * endpoint that opens it.
 *
 * `input` keeps them: a write is the moment the bounds can still be honoured.
 */
function workflowVariableSchema(id: string, mode: 'input' | 'stored' = 'input') {
  const name =
    mode === 'input'
      ? z.string().min(1, 'variable name cannot be empty').max(255, 'variable name is too long')
      : z.string()
  const type =
    mode === 'input'
      ? z.enum(WORKFLOW_VARIABLE_TYPES)
      : z.enum(WORKFLOW_VARIABLE_TYPES).catch('string')

  return z
    .object({
      id: z.string().min(1, 'variable id cannot be empty').describe('Variable identifier.'),
      name: name.describe('Variable name, referenced from block inputs.'),
      type: type.describe('Declared variable type.'),
      value: z
        .unknown()
        .describe('Variable value; free-form and validated per `type` at use time.'),
    })
    .meta({ id, title: 'Workflow variable', description: 'A workflow-scoped variable.' })
}

export const v2WorkflowBlockSchema = workflowBlockSchema('WorkflowBlock', 'stored')
export const v2WorkflowEdgeSchema = workflowEdgeSchema('WorkflowEdge')
const v2WorkflowLoopSchema = workflowLoopSchema('WorkflowLoop')
const v2WorkflowParallelSchema = workflowParallelSchema('WorkflowParallel')
export const v2WorkflowVariableSchema = workflowVariableSchema('WorkflowVariable', 'stored')

/**
 * The editable draft graph.
 *
 * A v2-local re-declaration rather than a reuse of the internal
 * `workflowStateSchema`: that one carries write-only legacy keys (`lastSaved`,
 * `isDeployed`, `deployedAt`, `metadata`) and bounds nothing.
 *
 * The graph elements above are deliberately **not** `.strict()`, unlike the
 * request bodies that carry them. They are both a response schema and a stored
 * shape, and a v2 response schema is `.parse`d on the way out — so a strict
 * element would turn any block, edge, or variable carrying a key this surface
 * has not published yet into a `500` on a plain read. Stripping instead makes
 * the read the canonical projection, which is also what makes a read-modify-write
 * round trip closed: what a caller reads back is exactly the set of keys it may
 * send.
 */
export const v2WorkflowGraphSchema = z
  .object({
    blocks: z
      .record(z.string(), v2WorkflowBlockSchema)
      .describe('Blocks keyed by block id.')
      .refine(
        (blocks) => Object.keys(blocks).length <= MAX_WORKFLOW_GRAPH_BLOCKS,
        `blocks cannot exceed ${MAX_WORKFLOW_GRAPH_BLOCKS} entries`
      ),
    edges: z
      .array(v2WorkflowEdgeSchema)
      .max(MAX_WORKFLOW_GRAPH_EDGES, `edges cannot exceed ${MAX_WORKFLOW_GRAPH_EDGES} entries`)
      .describe('Directed connections between blocks.'),
    loops: z
      .record(z.string(), v2WorkflowLoopSchema)
      .describe('Loop containers keyed by container id; always present, `{}` when there are none.'),
    parallels: z
      .record(z.string(), v2WorkflowParallelSchema)
      .describe(
        'Parallel containers keyed by container id; always present, `{}` when there are none.'
      ),
    variables: z
      .record(z.string(), v2WorkflowVariableSchema)
      .describe(
        'Workflow variables keyed by variable id; always present, `{}` when there are none.'
      ),
  })
  .strict()
  .meta({
    id: 'WorkflowGraph',
    title: 'Workflow graph',
    description:
      'The editable draft graph of a workflow: blocks, edges, derived loop and parallel containers, and variables.',
  })

export type V2WorkflowGraph = z.output<typeof v2WorkflowGraphSchema>

/**
 * Write-side graph elements.
 *
 * Structurally identical to the read schemas and deliberately so — what a caller
 * reads back is exactly what it may send. They are built separately only to
 * carry distinct OpenAPI component ids: a request body is generated in `input`
 * mode and a response in `output` mode, and the two spellings of the same object
 * genuinely differ, because an output object cannot carry unknown members having
 * just had them stripped.
 */
const v2WorkflowBlockInputSchema = workflowBlockSchema('WorkflowBlockInput')
const v2WorkflowEdgeInputSchema = workflowEdgeSchema('WorkflowEdgeInput')
const v2WorkflowLoopInputSchema = workflowLoopSchema('WorkflowLoopInput')
const v2WorkflowParallelInputSchema = workflowParallelSchema('WorkflowParallelInput')
const v2WorkflowVariableInputSchema = workflowVariableSchema('WorkflowVariableInput')

/**
 * Replace body. `loops` and `parallels` are accepted but ignored — both are
 * derived from the blocks on write, so declaring them optional keeps a
 * read-modify-write round trip working without promising they are honoured.
 */
export const v2ReplaceWorkflowStateBodySchema = z
  .object({
    blocks: z
      .record(z.string(), v2WorkflowBlockInputSchema)
      .describe('Blocks keyed by block id.')
      .refine(
        (blocks) => Object.keys(blocks).length <= MAX_WORKFLOW_GRAPH_BLOCKS,
        `blocks cannot exceed ${MAX_WORKFLOW_GRAPH_BLOCKS} entries`
      ),
    edges: z
      .array(v2WorkflowEdgeInputSchema)
      .max(MAX_WORKFLOW_GRAPH_EDGES, `edges cannot exceed ${MAX_WORKFLOW_GRAPH_EDGES} entries`)
      .describe('Directed connections between blocks.'),
    loops: z
      .record(z.string(), v2WorkflowLoopInputSchema)
      .optional()
      .describe('Ignored on write: loop containers are recomputed from `blocks`.'),
    parallels: z
      .record(z.string(), v2WorkflowParallelInputSchema)
      .optional()
      .describe('Ignored on write: parallel containers are recomputed from `blocks`.'),
    variables: z
      .record(z.string(), v2WorkflowVariableInputSchema)
      .optional()
      .describe('Replacement variable set. Omit to leave the stored variables untouched.'),
  })
  .strict()
  .meta({
    id: 'ReplaceWorkflowStateRequest',
    title: 'Replace workflow state request',
    description: 'A complete replacement draft graph for a workflow.',
    examples: [{ blocks: {}, edges: [] }],
  })

export type V2ReplaceWorkflowStateBody = z.input<typeof v2ReplaceWorkflowStateBodySchema>

const v2WorkflowGraphWriteResultSchema = z
  .object({
    id: z.string().describe('Identifier of the workflow whose draft graph was written.'),
    warnings: z
      .array(z.string())
      .describe(
        'Non-fatal notes about blocks and edges that were normalized or dropped before persistence. Empty when there was nothing to report.'
      ),
    needsRedeployment: z
      .boolean()
      .describe(
        'Whether the live deployment now differs from the draft. A graph write never changes what the deployed endpoint serves; deploy to publish it.'
      ),
  })
  .meta({
    id: 'WorkflowGraphWriteResult',
    title: 'Workflow graph write result',
    description: 'Outcome of a write against a workflow draft graph.',
  })

const v2WorkflowLintBlockRefSchema = z.object({
  blockId: z.string().describe('Block the finding is about.'),
  blockName: z.string().nullable().describe('Display name of the block, when it has one.'),
  blockType: z.string().nullable().describe('Registered type of the block, when it has one.'),
})

const v2WorkflowLintSchema = z
  .object({
    sources: z
      .array(v2WorkflowLintBlockRefSchema)
      .describe(
        'Blocks with no incoming edge. A trigger block is naturally a source; anything else here is unreachable.'
      ),
    sinks: z.array(v2WorkflowLintBlockRefSchema).describe('Blocks with no outgoing edge.'),
    orphanBlocks: z
      .array(v2WorkflowLintBlockRefSchema)
      .describe('Blocks with neither an incoming nor an outgoing edge.'),
    emptyOutgoingPorts: z
      .array(
        v2WorkflowLintBlockRefSchema.extend({
          handle: z.string().describe('Source handle with nothing connected to it.'),
          label: z.string().describe('Human-readable name of the port.'),
        })
      )
      .describe('Branch and container ports that lead nowhere.'),
    invalidBranchPorts: z
      .array(
        v2WorkflowLintBlockRefSchema.extend({
          sourceHandle: z.string().describe('Source handle that does not match the block.'),
          reason: z.string().describe('Why the handle is not valid for this block.'),
        })
      )
      .describe('Condition and router edges whose source handle names no real branch.'),
    invalidConnectionTargets: z
      .array(
        z.object({
          sourceBlockId: z.string().describe('Block the edge leaves.'),
          sourceBlockName: z.string().nullable().describe('Display name of the source block.'),
          sourceHandle: z.string().nullable().describe('Handle the edge leaves from.'),
          targetBlockId: z.string().describe('Block the edge points at.'),
          reason: z.string().describe('Why the target is not a legal destination.'),
        })
      )
      .describe('Edges pointing at a block that cannot legally receive them.'),
    fieldIssues: z
      .array(
        v2WorkflowLintBlockRefSchema.extend({
          missingRequiredFields: z
            .array(z.string())
            .describe('Required sub-block fields that resolve empty in the active mode.'),
          inactiveModeValues: z
            .array(
              z.object({
                canonicalId: z
                  .string()
                  .describe('Canonical parameter the two sub-block modes share.'),
                activeMemberId: z
                  .string()
                  .nullable()
                  .describe('Sub-block the runtime reads, where the value should live.'),
                inactiveMemberId: z
                  .string()
                  .describe('Sub-block holding the stranded value, which the runtime ignores.'),
                kind: z
                  .enum(['credential', 'resource', 'other'])
                  .describe('What kind of value is stranded.'),
              })
            )
            .describe('Values stranded on the inactive member of a canonical pair.'),
        })
      )
      .describe(
        'Per-block configuration problems. The most actionable part of the report for a headless graph builder: a block missing a required field will fail at run time.'
      ),
    unresolvedReferences: z
      .array(
        v2WorkflowLintBlockRefSchema.extend({
          field: z.string().describe('Sub-block field holding the reference.'),
          value: z
            .union([z.string(), z.array(z.string())])
            .describe('The reference, or references, that did not resolve.'),
          kind: z
            .enum(['credential', 'resource', 'custom-tool', 'mcp-tool', 'skill'])
            .describe('What kind of entity the reference was expected to name.'),
          reason: z.string().describe('Why the reference does not resolve.'),
        })
      )
      .describe(
        'Credential, resource, tool, and skill references that do not resolve. These values are still persisted; they are reported, not dropped.'
      ),
    notes: z.array(z.string()).describe('Advisory notes about the report itself.'),
  })
  .meta({
    id: 'WorkflowLintReport',
    title: 'Workflow lint report',
    description:
      'Advisory findings about the saved graph. Findings never block the write; they tell a caller what will misbehave at run time.',
  })

/**
 * Ask a graph write to validate and lint without persisting.
 *
 * A query parameter rather than a body field because the body of `PUT /state`
 * IS the graph — a dry-run flag inside it would make "am I committing this"
 * part of the resource representation, and a caller round-tripping a `GET`
 * into a `PUT` would carry it along. Kubernetes (`?dryRun=`) and Google Cloud
 * (`validateOnly`) both keep it outside the represented resource for the same
 * reason.
 */
const v2GraphWriteDryRunQuerySchema = z
  .object({
    dryRun: booleanQueryFlagSchema
      .optional()
      .describe(
        'Validate and lint without persisting. The response is identical to the committed write of the same body, so a caller can inspect `lint` and then re-send the request for real. Nothing is written, no audit entry is recorded, and collaborators are not notified.'
      ),
  })
  .strict()

export const v2ReplaceWorkflowStateDataSchema = v2WorkflowGraphWriteResultSchema
  .extend({
    lint: v2WorkflowLintSchema,
    dryRun: z
      .boolean()
      .describe(
        'Whether this request only validated. `true` means nothing was persisted; the findings describe what a committed write of the same body would produce.'
      ),
  })
  .meta({
    id: 'ReplaceWorkflowStateResult',
    title: 'Replace workflow state result',
    description: 'Outcome of replacing a workflow draft graph, with its advisory findings.',
  })
export type V2ReplaceWorkflowStateData = z.output<typeof v2ReplaceWorkflowStateDataSchema>

export const v2GetWorkflowStateContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/workflows/[workflowId]/state',
  query: noInputSchema,
  params: v2WorkflowIdParamsSchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2WorkflowGraphSchema),
  },
})

export const v2ReplaceWorkflowStateContract = defineRouteContract({
  method: 'PUT',
  path: '/api/v2/workflows/[workflowId]/state',
  query: v2GraphWriteDryRunQuerySchema,
  params: v2WorkflowIdParamsSchema,
  body: v2ReplaceWorkflowStateBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2ReplaceWorkflowStateDataSchema),
  },
})

/**
 * Every reason the edit engine can decline one operation. Derived from the
 * engine's own union, so a new skip reason fails to compile until it is
 * published here.
 */
export const v2WorkflowSkippedItemTypeSchema = z
  .enum(WORKFLOW_SKIPPED_ITEM_TYPES)
  .describe('Machine-readable reason the engine declined an operation.')

const v2WorkflowSkippedItemSchema = z
  .object({
    type: v2WorkflowSkippedItemTypeSchema,
    operationType: z.string().describe('The `operation_type` that was declined.'),
    blockId: z.string().describe('Block the declined operation targeted.'),
    reason: z.string().describe('Human-readable explanation.'),
    /** Engine-supplied context; its keys vary by `type`. */
    details: z
      .record(
        z.string(),
        z.unknown().describe('One piece of engine-supplied context for the reason.')
      )
      .optional()
      .describe('Additional context for the reason; keys depend on `type`.'),
  })
  .meta({
    id: 'WorkflowSkippedItem',
    title: 'Workflow skipped item',
    description: 'One operation the edit engine did not apply.',
  })

export type V2WorkflowSkippedItem = z.output<typeof v2WorkflowSkippedItemSchema>

/**
 * The envelope every block-configuring `params` shares, published because a
 * caller holding only the JSON type `object` cannot discover it. The wording is
 * the guidance the Copilot tool catalog has carried for `edit_workflow` since
 * before this endpoint existed — the two are the same engine, so they should
 * not describe it differently.
 */
const WORKFLOW_OPERATION_PARAM_ENVELOPE =
  '`inputs` maps sub-block ids directly to values, never through `subBlocks`. Keep `retry`, ' +
  '`triggerMode`, and `advancedMode` beside `inputs`. `connections` maps source handles to ' +
  'target ids, `{ block, handle }`, or arrays; `success` aliases `source`.'

const v2AgentToolUsageControlSchema = z
  .enum(['auto', 'force', 'none'])
  .describe(
    'When the Agent may call the tool: `auto` lets the model decide, `force` requires a call, and `none` disables it. Omitted means `auto`.'
  )

const v2AgentToolParamsSchema = z
  .record(z.string(), z.unknown().describe('One tool parameter value.'))
  .describe(
    'Parameters fixed by the workflow author. Parameters left out remain available for the model to supply when the tool declares them.'
  )

/** A catalog integration attached directly to an Agent block. */
export const v2AgentIntegrationToolSchema = z
  .object({
    type: z
      .string()
      .trim()
      .min(1, 'Agent integration tool type cannot be empty')
      .max(255, 'Agent integration tool type must be at most 255 characters')
      .regex(
        /^(?!(?:custom-tool|mcp|mcp-server-advanced)$).+$/,
        'Agent integration tool type must be a catalog block id, not a reserved custom or MCP type'
      )
      .describe(
        'Catalog block id, such as `cloudwatch` or `slack`. Use the block id, never an underlying tool id.'
      ),
    operation: z
      .string()
      .trim()
      .min(1, 'Agent integration tool operation cannot be empty')
      .max(255, 'Agent integration tool operation must be at most 255 characters')
      .optional()
      .describe(
        'Operation ID from Get Block. Required when the block exposes multiple operations; it may differ from the tool ID.'
      ),
    usageControl: v2AgentToolUsageControlSchema.optional(),
    params: v2AgentToolParamsSchema.optional(),
  })
  .catchall(
    z
      .unknown()
      .describe('Forward-compatible integration tool metadata preserved by the workflow editor.')
  )
  .meta({
    id: 'AgentIntegrationTool',
    title: 'Agent integration tool',
    description:
      'A catalog integration operation the Agent may call. Resolve valid block and operation ids through the block catalog.',
    examples: [
      {
        type: 'cloudwatch',
        operation: 'describe_alarm_history',
        usageControl: 'auto',
        params: {},
      },
    ],
  })

const v2AgentCustomToolReferenceSchema = z
  .object({
    type: z.literal('custom-tool').describe('Custom-tool discriminator.'),
    customToolId: z
      .string()
      .trim()
      .min(1, 'Agent customToolId cannot be empty')
      .max(255, 'Agent customToolId must be at most 255 characters')
      .describe('Custom tool ID from List Custom Tools.'),
    usageControl: v2AgentToolUsageControlSchema.optional(),
  })
  .catchall(
    z
      .unknown()
      .describe('Forward-compatible custom tool metadata preserved by the workflow editor.')
  )

const v2AgentInlineCustomToolSchema = z
  .object({
    type: z.literal('custom-tool').describe('Custom-tool discriminator.'),
    schema: z
      .object({
        type: z.literal('function').optional().describe('Function declaration discriminator.'),
        function: z
          .object({
            name: z
              .string()
              .trim()
              .min(1, 'Inline custom tool function name cannot be empty')
              .max(64, 'Inline custom tool function name must be at most 64 characters')
              .describe('Function name presented to the model.'),
            description: z.string().optional().describe('What the inline custom tool does.'),
            parameters: z
              .record(
                z.string(),
                z.unknown().describe('One JSON Schema keyword on the function parameters.')
              )
              .describe('JSON Schema describing the function arguments.'),
          })
          .catchall(z.unknown().describe('Additional function declaration metadata.'))
          .describe('OpenAI-style function definition.'),
      })
      .catchall(z.unknown().describe('Additional custom tool declaration metadata.'))
      .describe('Inline OpenAI-style function declaration.'),
    code: z.string().describe('Inline tool implementation executed by the Function runtime.'),
    usageControl: v2AgentToolUsageControlSchema.optional(),
  })
  .catchall(
    z
      .unknown()
      .describe('Forward-compatible custom tool metadata preserved by the workflow editor.')
  )

/** A workspace custom tool attached directly to an Agent block. */
export const v2AgentCustomToolSchema = z
  .union([v2AgentCustomToolReferenceSchema, v2AgentInlineCustomToolSchema])
  .meta({
    id: 'AgentCustomTool',
    title: 'Agent custom tool',
    description:
      'A workspace custom tool. Prefer `customToolId`; inline declarations are also accepted.',
    examples: [
      {
        type: 'custom-tool',
        customToolId: 'cst_01J9X2ABCDEF',
        usageControl: 'auto',
      },
    ],
  })

/** An MCP server tool attached directly to an Agent block. */
export const v2AgentMcpToolSchema = z
  .object({
    type: z.literal('mcp').describe('MCP-tool discriminator.'),
    params: z
      .intersection(
        z
          .object({
            serverId: z
              .string()
              .trim()
              .min(1, 'Agent MCP serverId cannot be empty')
              .max(MAX_ID_LENGTH, `Agent MCP serverId must be at most ${MAX_ID_LENGTH} characters`)
              .describe('MCP server id returned by `GET /api/v2/mcp-servers`.'),
            toolName: z
              .string()
              .trim()
              .min(1, 'Agent MCP toolName cannot be empty')
              .max(
                MAX_MCP_TOOL_NAME_BYTES,
                `Agent MCP toolName must be at most ${MAX_MCP_TOOL_NAME_BYTES} characters`
              )
              .refine(
                (toolName) =>
                  new TextEncoder().encode(toolName).byteLength <= MAX_MCP_TOOL_NAME_BYTES,
                `Agent MCP toolName must be at most ${MAX_MCP_TOOL_NAME_BYTES} bytes`
              )
              .describe('Tool name returned by the MCP server’s tools endpoint.'),
          })
          .catchall(z.unknown().describe('One parameter fixed by the workflow author.')),
        z.record(z.string(), z.unknown().describe('One parameter fixed by the workflow author.'))
      )
      .describe(
        'MCP server and tool identity plus any tool arguments fixed by the workflow author.'
      ),
    usageControl: v2AgentToolUsageControlSchema.optional(),
  })
  .catchall(
    z.unknown().describe('Forward-compatible MCP tool metadata preserved by the workflow editor.')
  )
  .meta({
    id: 'AgentMcpTool',
    title: 'Agent MCP tool',
    description: 'One tool discovered from a workspace MCP server.',
    examples: [
      {
        type: 'mcp',
        params: { serverId: 'mcp_01J9X2ABCDEF', toolName: 'search_docs' },
        usageControl: 'auto',
      },
    ],
  })

/** Every tool currently available through one workspace MCP server. */
export const v2AgentMcpServerAdvancedSchema = z
  .object({
    type: z.literal('mcp-server-advanced').describe('Server-wide MCP binding discriminator.'),
    params: z
      .object({
        serverId: z
          .string()
          .trim()
          .min(1, 'Agent MCP serverId cannot be empty')
          .max(MAX_ID_LENGTH, `Agent MCP serverId must be at most ${MAX_ID_LENGTH} characters`)
          .describe(
            'Workspace MCP server ID or explicit credential-group managed MCP connection ID.'
          ),
      })
      .strict()
      .describe('Server identity for discovering and invoking every available MCP tool.'),
    usageControl: v2AgentToolUsageControlSchema.optional(),
  })
  .catchall(
    z.unknown().describe('Forward-compatible MCP server metadata preserved by the workflow editor.')
  )
  .meta({
    id: 'AgentMcpServerAdvanced',
    title: 'Agent MCP server (advanced)',
    description: 'All tools available to the executing subject from one MCP server.',
    examples: [
      {
        type: 'mcp-server-advanced',
        params: { serverId: 'mcp_01J9X2ABCDEF' },
        usageControl: 'auto',
      },
    ],
  })

/** One callable tool attached directly to an Agent block. */
export const v2AgentToolSchema = z
  .xor([
    v2AgentIntegrationToolSchema,
    v2AgentCustomToolSchema,
    v2AgentMcpToolSchema,
    v2AgentMcpServerAdvancedSchema,
  ])
  .meta({
    id: 'AgentTool',
    title: 'Agent tool',
    description:
      'A catalog integration operation, workspace custom tool, or MCP tool available to an Agent.',
  })
export type V2AgentTool = z.input<typeof v2AgentToolSchema>

/** The stored value of an Agent block's `tools` input. */
export const v2AgentToolInputSchema = z
  .array(v2AgentToolSchema)
  .max(MAX_AGENT_TOOLS_PER_BLOCK, `Agent tools cannot exceed ${MAX_AGENT_TOOLS_PER_BLOCK} entries`)
  .describe(
    'Tools the Agent may call. Integration `type` and `operation` values come from `GET /api/v2/blocks/{blockId}`; custom and MCP identifiers come from their workspace catalog endpoints.'
  )
  .meta({
    id: 'AgentToolInput',
    title: 'Agent tools input',
    description: 'The complete value stored in an Agent block’s `tools` input.',
  })
export type V2AgentToolInput = z.input<typeof v2AgentToolInputSchema>

const v2WorkflowOperationInputsSchema = z
  .intersection(
    z
      .object({
        tools: v2AgentToolInputSchema
          .optional()
          .describe(
            'Agent tools configuration. Applies to a `tool-input` field; other block inputs remain catalog-defined.'
          ),
      })
      .catchall(
        z
          .unknown()
          .describe(
            'One block-specific input whose accepted shape is published by the block catalog.'
          )
      ),
    z.record(
      z.string(),
      z
        .unknown()
        .describe(
          'One block-specific input whose accepted shape is published by the block catalog.'
        )
    )
  )
  .describe('Block configuration keyed by sub-block id.')

/**
 * The keys `edit` accepts. Open because the per-block input set is defined by
 * the block registry rather than by this contract, but the envelope around it
 * is fixed and worth publishing — a caller that has only the type `object` can
 * rename a block and nothing else.
 */
const v2WorkflowOperationParamsSchema = z
  .intersection(
    z
      .object({
        inputs: v2WorkflowOperationInputsSchema.optional(),
      })
      .catchall(
        z.unknown().describe('One operation parameter; see the description for the accepted keys.')
      ),
    z.record(
      z.string(),
      z.unknown().describe('One operation parameter; see the description for the accepted keys.')
    )
  )
  .describe(
    'Patch only supplied fields: `inputs`, `name`, `connections`, `removeEdges`, `nestedNodes`, ' +
      `\`retry\`, \`triggerMode\`, and \`advancedMode\`. ${WORKFLOW_OPERATION_PARAM_ENVELOPE} ` +
      'Re-sending `connections` replaces outgoing edges; use `removeEdges` to delete selected edges.'
  )

const v2AddWorkflowBlockParamsSchema = z
  .object({
    type: z
      .string()
      .min(1, 'params.type is required to add a block')
      .describe('Registered block type.'),
    name: z
      .string()
      .min(1, 'params.name is required to add a block')
      .describe('Block display name.'),
    inputs: v2WorkflowOperationInputsSchema.optional(),
  })
  .catchall(z.unknown().describe('One block-specific input or connection descriptor.'))
  .describe(
    'Block `type`, `name`, and optional `inputs`, `connections`, `retry`, `triggerMode`, or ' +
      '`advancedMode`. ' +
      WORKFLOW_OPERATION_PARAM_ENVELOPE
  )

const v2SubflowMembershipParamsSchema = z
  .object({
    subflowId: z
      .string()
      .min(1, 'params.subflowId is required')
      .describe('Loop or parallel container the block moves into or out of.'),
  })
  .catchall(z.unknown().describe('One block-specific input.'))
  .describe('Container identifier, plus any block-specific inputs.')

const v2InsertIntoSubflowParamsSchema = z
  .object({
    subflowId: z
      .string()
      .min(1, 'params.subflowId is required')
      .describe('Loop or parallel container to insert the block into.'),
    type: z
      .string()
      .min(1, 'params.type is required to insert a block')
      .describe('Registered block type.'),
    name: z
      .string()
      .min(1, 'params.name is required to insert a block')
      .describe('Block display name.'),
    inputs: v2WorkflowOperationInputsSchema.optional(),
  })
  .catchall(z.unknown().describe('One block-specific input or connection descriptor.'))
  .describe(
    'Container, block `type`, `name`, and the same optional fields as `add`. ' +
      WORKFLOW_OPERATION_PARAM_ENVELOPE
  )

const v2WorkflowOperationBlockIdSchema = z
  .string()
  .min(1, 'block_id cannot be empty')
  .describe('Block the operation targets. For `add`, the id the new block will be given.')

/**
 * One semantic edit. A discriminated union on `operation_type` so a client gets
 * exhaustive narrowing and each variant declares the parameters it actually
 * requires — `add` and `insert_into_subflow` cannot omit the block type and
 * name, and `delete` accepts no parameters at all.
 */
export const v2WorkflowOperationSchema = z
  .discriminatedUnion('operation_type', [
    z
      .object({
        operation_type: z.literal('add').describe('Create a new block.'),
        block_id: v2WorkflowOperationBlockIdSchema,
        params: v2AddWorkflowBlockParamsSchema,
      })
      .strict(),
    z
      .object({
        operation_type: z
          .literal('edit')
          .describe('Change an existing block: its inputs, name, or connections.'),
        block_id: v2WorkflowOperationBlockIdSchema,
        params: v2WorkflowOperationParamsSchema,
      })
      .strict(),
    z
      .object({
        operation_type: z.literal('delete').describe('Remove a block and every edge touching it.'),
        block_id: v2WorkflowOperationBlockIdSchema,
      })
      .strict(),
    z
      .object({
        operation_type: z
          .literal('insert_into_subflow')
          .describe('Create a block inside a loop or parallel container.'),
        block_id: v2WorkflowOperationBlockIdSchema,
        params: v2InsertIntoSubflowParamsSchema,
      })
      .strict(),
    z
      .object({
        operation_type: z
          .literal('extract_from_subflow')
          .describe('Move a block out of its loop or parallel container.'),
        block_id: v2WorkflowOperationBlockIdSchema,
        params: v2SubflowMembershipParamsSchema,
      })
      .strict(),
  ])
  .meta({
    id: 'WorkflowEditOperation',
    title: 'Workflow edit operation',
    description: 'One semantic edit against a workflow graph.',
  })

export type V2WorkflowOperation = z.input<typeof v2WorkflowOperationSchema>

export const v2ApplyWorkflowOperationsBodySchema = z
  .object({
    operations: z
      .array(v2WorkflowOperationSchema)
      .min(1, 'operations cannot be empty')
      .max(
        MAX_WORKFLOW_EDIT_OPERATIONS,
        `operations cannot exceed ${MAX_WORKFLOW_EDIT_OPERATIONS} entries`
      )
      .describe('Edits to apply, in a single batch.'),
    atomic: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        'Fail the whole batch when any operation is declined or any block input would be dropped. The default applies what it can and reports the rest in `skipped` and `inputValidationErrors`; `true` writes nothing and answers `409` instead.'
      ),
    layout: z
      .enum(['targeted', 'none'])
      .optional()
      .default('targeted')
      .describe(
        'Whether to reposition blocks the batch touched. `targeted` (default) nudges only the affected subgraph; `none` leaves every position exactly as supplied.'
      ),
    setBlockEnabled: z
      .array(
        z
          .object({
            block_id: v2WorkflowOperationBlockIdSchema,
            enabled: z.boolean().describe('Whether the block should run.'),
          })
          .strict()
      )
      .max(
        MAX_WORKFLOW_EDIT_OPERATIONS,
        `setBlockEnabled cannot exceed ${MAX_WORKFLOW_EDIT_OPERATIONS} entries`
      )
      .optional()
      .describe(
        'Blocks to enable or disable, applied after `operations`. Disabling a loop or parallel cascades to its unlocked descendants; enabling a block whose container is disabled is declined.'
      ),
  })
  .strict()
  .meta({
    id: 'ApplyWorkflowOperationsRequest',
    title: 'Apply workflow operations request',
    description: 'A batch of semantic edits against a workflow graph.',
    examples: [
      {
        operations: [
          {
            operation_type: 'add',
            block_id: 'agent-1',
            params: {
              type: 'agent',
              name: 'Triage',
              inputs: {
                tools: [
                  {
                    type: 'cloudwatch',
                    operation: 'describe_alarm_history',
                    usageControl: 'auto',
                    params: {},
                  },
                ],
              },
            },
          },
        ],
      },
    ],
  })

export type V2ApplyWorkflowOperationsBody = z.input<typeof v2ApplyWorkflowOperationsBodySchema>

const v2WorkflowInputValidationErrorSchema = z
  .object({
    blockId: z.string().describe('Block whose input was rejected.'),
    blockType: z.string().describe('Type of the block whose input was rejected.'),
    field: z.string().describe('Sub-block field that was rejected.'),
    error: z.string().describe('Why the value was rejected.'),
  })
  .meta({
    id: 'WorkflowInputValidationError',
    title: 'Workflow input validation error',
    description: 'One block input that was dropped rather than persisted.',
  })

export const v2ApplyWorkflowOperationsDataSchema = v2WorkflowGraphWriteResultSchema
  .extend({
    applied: z.number().int().nonnegative().describe('Operations the engine applied.'),
    skipped: z
      .array(v2WorkflowSkippedItemSchema)
      .describe('Operations the engine declined. Empty when everything applied.'),
    deferred: z
      .array(v2WorkflowSkippedItemSchema)
      .describe(
        'Edges waiting for target blocks. They apply automatically when their targets exist, in this batch or a later one. Do not resubmit them.'
      ),
    inputValidationErrors: z
      .array(v2WorkflowInputValidationErrorSchema)
      .describe(
        'Block inputs that were dropped rather than persisted, and only those. The rest of the operation still applied. References that merely fail to resolve stay persisted and are reported in `lint.unresolvedReferences` instead.'
      ),
    mintedBlockIds: z
      .record(z.string(), z.string().describe('The id the block was actually given.'))
      .describe(
        'Minted block ids keyed by requested `block_id`, present only when they differ. References within this batch are remapped automatically; later requests must use the minted id. Supply a UUID when the requested id must survive unchanged.'
      ),
    lint: v2WorkflowLintSchema,
    dryRun: z
      .boolean()
      .describe(
        'Whether this request only evaluated. `true` means nothing was persisted; the outcome describes what a committed apply of the same body would produce.'
      ),
  })
  .meta({
    id: 'ApplyWorkflowOperationsResult',
    title: 'Apply workflow operations result',
    description: 'Outcome of a batch of semantic edits against a workflow graph.',
  })

export type V2ApplyWorkflowOperationsData = z.output<typeof v2ApplyWorkflowOperationsDataSchema>

export const v2ApplyWorkflowOperationsContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/workflows/[workflowId]/operations',
  query: v2GraphWriteDryRunQuerySchema,
  params: v2WorkflowIdParamsSchema,
  body: v2ApplyWorkflowOperationsBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2ApplyWorkflowOperationsDataSchema),
  },
})

export const v2ApplyWorkflowVariablesBodySchema = z
  .object({
    operations: z
      .array(
        z
          .discriminatedUnion('operation', [
            z
              .object({
                operation: z.literal('add').describe('Create a variable with this name.'),
                name: z
                  .string()
                  .min(1, 'name cannot be empty')
                  .max(255, 'name is too long')
                  .describe('Variable name.'),
                type: v2WorkflowVariableInputSchema.shape.type.describe('Declared variable type.'),
                value: z.unknown().describe('Variable value, coerced to `type`.'),
              })
              .strict(),
            z
              .object({
                operation: z
                  .literal('edit')
                  .describe('Replace the value, and optionally the type, of an existing variable.'),
                name: z
                  .string()
                  .min(1, 'name cannot be empty')
                  .max(255, 'name is too long')
                  .describe('Name of the variable to update.'),
                type: v2WorkflowVariableInputSchema.shape.type
                  .optional()
                  .describe('Replacement type; the stored type is kept when omitted.'),
                value: z.unknown().describe('Replacement value, coerced to the effective type.'),
              })
              .strict(),
            z
              .object({
                operation: z.literal('delete').describe('Remove the variable with this name.'),
                name: z
                  .string()
                  .min(1, 'name cannot be empty')
                  .max(255, 'name is too long')
                  .describe('Name of the variable to remove.'),
              })
              .strict(),
          ])
          .describe('One variable change.')
      )
      .min(1, 'operations cannot be empty')
      .max(
        MAX_WORKFLOW_VARIABLE_OPERATIONS,
        `operations cannot exceed ${MAX_WORKFLOW_VARIABLE_OPERATIONS} entries`
      )
      .describe('Variable changes to apply, in order.'),
  })
  .strict()
  .meta({
    id: 'ApplyWorkflowVariablesRequest',
    title: 'Apply workflow variables request',
    description: 'Additions, edits, and deletions against a workflow’s variables.',
  })

export type V2ApplyWorkflowVariablesBody = z.input<typeof v2ApplyWorkflowVariablesBodySchema>

export const v2ApplyWorkflowVariablesDataSchema = z
  .object({
    id: z.string().describe('Identifier of the workflow whose variables were updated.'),
    variableCount: z.number().int().nonnegative().describe('Variables the workflow now holds.'),
    changed: z
      .boolean()
      .describe('Whether anything actually changed. A no-op batch answers `200` with `false`.'),
  })
  .meta({
    id: 'ApplyWorkflowVariablesResult',
    title: 'Apply workflow variables result',
    description: 'Outcome of a workflow variable update.',
  })

export type V2ApplyWorkflowVariablesData = z.output<typeof v2ApplyWorkflowVariablesDataSchema>

export const v2ApplyWorkflowVariablesContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/v2/workflows/[workflowId]/variables',
  query: noInputSchema,
  params: v2WorkflowIdParamsSchema,
  body: v2ApplyWorkflowVariablesBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2ApplyWorkflowVariablesDataSchema),
  },
})

export const v2DuplicateWorkflowBodySchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'name cannot be empty')
      .max(255, 'name is too long')
      .optional()
      .describe('Name for the copy. Defaults to the source name, deduplicated within the folder.'),
    folderPath: v2FolderPathInputSchema
      .optional()
      .describe("Destination folder path. Defaults to the source workflow's folder."),
  })
  .strict()
  .meta({
    id: 'DuplicateWorkflowRequest',
    title: 'Duplicate workflow request',
    description: 'Optional name and destination folder for the copy.',
    examples: [{ name: 'Customer support triage (copy)', folderPath: '/Operations' }],
  })

export type V2DuplicateWorkflowBody = z.input<typeof v2DuplicateWorkflowBodySchema>

export const v2DuplicateWorkflowContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/workflows/[workflowId]/duplicate',
  query: noInputSchema,
  params: v2WorkflowIdParamsSchema,
  body: v2DuplicateWorkflowBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2WorkflowListItemSchema),
    status: 201,
  },
})

export const v2RestoreWorkflowContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/workflows/[workflowId]/restore',
  query: noInputSchema,
  params: v2WorkflowIdParamsSchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2WorkflowListItemSchema),
  },
})

export const v2MoveWorkflowsBodySchema = z
  .object({
    workspaceId: workspaceIdSchema.describe('Workspace holding every workflow in the batch.'),
    workflowIds: z
      .array(z.string().min(1, 'workflowIds entries cannot be empty'))
      .min(1, 'workflowIds cannot be empty')
      .max(MAX_WORKFLOW_BULK_MOVES, `workflowIds cannot exceed ${MAX_WORKFLOW_BULK_MOVES} entries`)
      .describe('Workflows to move. Duplicates are collapsed.'),
    folderPath: v2FolderPathInputSchema.describe(
      'Destination folder path; `/` moves the workflows to the workspace root.'
    ),
  })
  .strict()
  .meta({
    id: 'MoveWorkflowsRequest',
    title: 'Move workflows request',
    description: 'Workflows to relocate and the folder to relocate them into.',
    examples: [
      {
        workspaceId: 'a91c4b2e-6d3f-4e8a-b5c7-0d9e2f1a8c64',
        workflowIds: ['3b1f7c92-8d4e-4a6b-9c0d-5e2f8a714b36'],
        folderPath: '/Operations',
      },
    ],
  })

export type V2MoveWorkflowsBody = z.input<typeof v2MoveWorkflowsBodySchema>

export const v2MoveWorkflowsDataSchema = z
  .object({
    moved: z.array(z.string()).describe('Workflows that were relocated.'),
    failed: z
      .array(z.string())
      .describe(
        'Workflows that were not relocated — absent from the workspace, archived, or locked. Best-effort by design: the rest of the batch still moved.'
      ),
    folderPath: v2FolderPathSchema.describe('Canonical destination folder path.'),
  })
  .meta({
    id: 'MoveWorkflowsResult',
    title: 'Move workflows result',
    description: 'Which workflows moved and which did not.',
  })

export type V2MoveWorkflowsData = z.output<typeof v2MoveWorkflowsDataSchema>

export const v2MoveWorkflowsContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/workflows/move',
  query: noInputSchema,
  body: v2MoveWorkflowsBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2MoveWorkflowsDataSchema),
  },
})
