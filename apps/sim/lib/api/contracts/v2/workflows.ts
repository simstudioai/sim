import { z } from 'zod'
import {
  activeDeploymentSummarySchema,
  deployedWorkflowStateSchema,
  deploymentOperationSummarySchema,
  deploymentVersionParamsSchema,
  deploymentVersionSchema,
} from '@/lib/api/contracts/deployments'
import { booleanQueryFlagSchema, workspaceIdSchema } from '@/lib/api/contracts/primitives'
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
  workflowExecutionPausedDetailSchema,
  workflowExecutionStatusQuerySchema,
  workflowIdParamsSchema,
} from '@/lib/api/contracts/workflows'
import { MAX_WORKFLOW_EXECUTION_TIMEOUT_SECONDS } from '@/lib/billing/execution-timeout-defaults'
import { PERSISTED_WORKFLOW_EXECUTION_STATUSES } from '@/lib/logs/types'

export const V2_WORKFLOW_RUN_ID_HEADER = 'X-Run-Id'

export const v2WorkflowRunIdSchema = z
  .string()
  .min(1, 'Invalid run ID')
  .max(128, 'Run ID too long')
  .regex(
    /^[A-Za-z0-9._:-]+$/,
    'Run ID can only contain letters, numbers, dots, underscores, colons, and hyphens'
  )
  .describe('Unique workflow run identifier.')
  .meta({ examples: ['run_8f14e45f-ceea-467f-a'] })

/**
 * `X-Run-Id` is a **one-shot uniqueness claim, not an idempotency key.** The
 * first request to claim a value starts a run; every later request reusing it
 * is rejected with a `409` carrying `error.details.code: "RUN_ID_CONFLICT"`, and
 * the original result is never
 * replayed. Retry logic written against idempotency-key semantics either
 * double-executes (fresh id per attempt) or hard-fails (same id per attempt).
 */
const X_RUN_ID_DESCRIPTION =
  'Caller-supplied run identifier, available only to API-key callers. This is a one-shot uniqueness claim, NOT an idempotency key: the first request to use a value starts a run, and any later request reusing it fails with 409 and `error.details.code: "RUN_ID_CONFLICT"` instead of replaying the original result. To retry safely, generate a fresh value per attempt and reconcile duplicates yourself, or omit the header and let the server allocate the run identifier.'

const X_SIM_VIA_DESCRIPTION =
  'Comma-separated workflow identifiers describing the workflow-to-workflow call chain that led to this request. Each hop appends its own workflow id, and Sim sets it automatically when one workflow calls another; supply it yourself only when relaying an existing chain. A chain already at the maximum depth is rejected with 409 and `error.details.code: "CALL_CHAIN_DEPTH_EXCEEDED"`, which is how runaway recursion between workflows is stopped.'

export const v2ExecuteWorkflowHeadersSchema = z
  .object({
    'x-run-id': v2WorkflowRunIdSchema.optional().describe(X_RUN_ID_DESCRIPTION),
    'x-sim-via': z.string().optional().describe(X_SIM_VIA_DESCRIPTION),
  })
  .meta({
    id: 'ExecuteWorkflowHeaders',
    title: 'Execute workflow headers',
    description:
      'Optional one-shot run-identifier claim and workflow call-chain marker for a workflow execution. Reusing an `X-Run-Id` returns 409 and `error.details.code: "RUN_ID_CONFLICT"`; it does not replay the earlier run. An `X-Sim-Via` chain at maximum depth returns 409 and `error.details.code: "CALL_CHAIN_DEPTH_EXCEEDED"`.',
  })
export type V2ExecuteWorkflowHeaders = z.input<typeof v2ExecuteWorkflowHeadersSchema>

export const v2WorkflowRunParamsSchema = z
  .object({
    id: z.string().min(1, 'Invalid workflow ID').describe('Unique workflow identifier.'),
    runId: v2WorkflowRunIdSchema.describe('Unique workflow run identifier.'),
  })
  .meta({
    id: 'WorkflowRunParams',
    title: 'Workflow run path parameters',
    description: 'Workflow and run selected by the request path.',
  })
export type V2WorkflowRunParams = z.input<typeof v2WorkflowRunParamsSchema>

/**
 * v2 workflows contracts. Request shapes are reused from v1 (the `[id]` param
 * is unchanged, and the list query extends v1's with the v2 search/sort
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
export const v2ListWorkflowsQuerySchema = z
  .object({
    workspaceId: workspaceIdSchema.describe('Workspace whose workflows should be listed.'),
    folderPath: v2FolderPathInputSchema
      .optional()
      .describe('Restrict results to workflows in this folder path.'),
    deployedOnly: booleanQueryFlagSchema
      .optional()
      .default(false)
      .describe('Return only workflows with an active deployment when true.'),
    limit: z.coerce
      .number()
      .min(1)
      .max(100)
      .optional()
      .default(50)
      .describe('Maximum workflows to return per page.'),
    cursor: z
      .string()
      .optional()
      .describe('Opaque pagination cursor returned by a previous request.'),
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
    runCount: z.number().int().nonnegative().describe('Total recorded workflow runs.'),
    lastRunAt: z
      .string()
      .nullable()
      .describe('ISO 8601 timestamp of the latest run, or null when never run.')
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
  .extend({
    id: workflowIdParamsSchema.shape.id
      .describe('Unique workflow identifier.')
      .meta({ examples: ['3b1f7c92-8d4e-4a6b-9c0d-5e2f8a714b36'] }),
  })
  .meta({
    id: 'WorkflowIdParams',
    title: 'Workflow path parameters',
    description: 'Workflow selected by the request path.',
  })

export const v2DeploymentVersionParamsSchema = deploymentVersionParamsSchema
  .extend({
    id: deploymentVersionParamsSchema.shape.id.describe('Unique workflow identifier.'),
    version: deploymentVersionParamsSchema.shape.version
      .describe('Numeric deployment version.')
      .meta({ examples: [3] }),
  })
  .meta({
    id: 'WorkflowVersionParams',
    title: 'Workflow version path parameters',
    description: 'Workflow and deployment version selected by the request path.',
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
      'Deployment attempt accepted for processing. Activation is asynchronous; `latestDeploymentAttempt` on this response is the attempt handle. The request is NOT idempotent — every POST mints a new deployment version, so a retry after a timeout creates a second version rather than returning the first. `latestDeploymentAttempt` is returned only here: `GET /workflows/{id}` does not carry it, so poll activation with `isDeployed` and `deployedAt` on the workflow, or with `isActive` on `GET /workflows/{id}/versions`.',
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
      .string()
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
    id: z.string().describe('Identifier of the deleted workflow.'),
    deleted: z.literal(true).describe('Confirms that the workflow was deleted.'),
  })
  .meta({
    id: 'DeleteWorkflowResult',
    title: 'Delete workflow result',
    description: 'Confirmation that a workflow was deleted.',
  })
export type V2DeleteWorkflowData = z.output<typeof v2DeleteWorkflowDataSchema>

export const v2CreateWorkflowContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/workflows',
  body: v2CreateWorkflowBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2WorkflowListItemSchema),
    status: 201,
  },
})

export const v2UpdateWorkflowContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/v2/workflows/[id]',
  params: v2WorkflowIdParamsSchema,
  body: v2UpdateWorkflowBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2WorkflowListItemSchema),
  },
})

export const v2DeleteWorkflowContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/v2/workflows/[id]',
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
  response: { mode: 'json', schema: v2CursorListResponse(v2WorkflowFolderSchema) },
})

export const v2CreateWorkflowFolderContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/workflows/folders',
  body: v2CreateFolderBodySchema,
  response: { mode: 'json', schema: v2DataResponse(v2WorkflowFolderSchema), status: 201 },
})

export const v2RelocateWorkflowFolderContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/v2/workflows/folders',
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
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .default(50)
      .describe('Maximum deployment versions to return per page.'),
    cursor: z
      .string()
      .optional()
      .describe('Opaque pagination cursor returned by a previous request.'),
  })
  .meta({
    id: 'ListWorkflowVersionsQuery',
    title: 'List workflow versions query',
    description: 'Pagination for deployment versions of a workflow.',
  })
export type V2ListWorkflowVersionsQuery = z.output<typeof v2ListWorkflowVersionsQuerySchema>

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
      'Deployed workflow graph snapshot pinned by this version. Credential-bearing values are redacted: `oauth-input`, `password: true`, and table sub-block values are null; sensitive nested tool parameters and every parameter without authoritative codec metadata are null.'
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
  path: '/api/v2/workflows/[id]/versions',
  params: v2WorkflowIdParamsSchema,
  query: v2ListWorkflowVersionsQuerySchema,
  response: {
    mode: 'json',
    schema: v2CursorListResponse(v2WorkflowVersionSchema),
  },
})

export const v2GetWorkflowVersionContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/workflows/[id]/versions/[version]',
  params: v2DeploymentVersionParamsSchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2WorkflowVersionDetailSchema),
  },
})

export const v2DeployWorkflowContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/workflows/[id]/deploy',
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
  path: '/api/v2/workflows/[id]/deploy',
  params: v2WorkflowIdParamsSchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2UndeployWorkflowDataSchema),
  },
})

export const v2RollbackWorkflowContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/workflows/[id]/rollback',
  params: v2WorkflowIdParamsSchema,
  body: v1RollbackWorkflowBodySchema
    .extend({
      version: v1RollbackWorkflowBodySchema.shape.version.describe(
        'Deployment version to reactivate. Omit to select the previous active version.'
      ),
    })
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
 * Structured execution error — mirrors `WorkflowExecutionErrorCode` in
 * `@/executor/utils/errors` (duplicated literally: contracts are
 * client-importable and must not pull executor modules). APPEND-ONLY: callers
 * route on these instead of substring-matching messages.
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
        'OUTPUT_TOO_LARGE',
        'EXECUTION_FAILED',
      ])
      .describe('Stable machine-readable execution failure code.'),
    /** Failing block, when attributable. Deliberately crosses the workspace boundary for shared/child workflows — the runId + block context is the reproducible handle a caller hands the workflow provider. */
    blockId: z.string().optional().describe('Identifier of the failing block, when attributable.'),
    blockName: z.string().optional().describe('Display name of the failing block.'),
    blockType: z.string().optional().describe('Integration or block type that failed.'),
  })
  .meta({
    id: 'ExecutionError',
    title: 'Execution error',
    description: 'Structured in-band failure details for a workflow run.',
  })
export type V2ExecutionError = z.output<typeof v2ExecutionErrorSchema>

/**
 * The mutually-exclusive execute option matrix, mirrored from the route's
 * post-parse checks in `app/api/v2/workflows/[id]/execute/route.ts`. Kept as one
 * exported string so the request-body description and the OpenAPI operation
 * description cannot drift from each other.
 */
export const EXECUTE_OPTION_CONSTRAINTS =
  'Option constraints — each is a 400: (1) `async: true` requires an API key; anonymous public-workflow callers may only execute synchronously or as a stream. (2) `async` and `stream` cannot both be true. (3) `executionTimeoutSeconds` is accepted only when `async: true`. (4) `async: true` rejects every streaming and output-shaping option — `selectedOutputs`, `includeThinking`, `includeToolCalls`, `includeFileBase64`, and `base64MaxBytes`. (5) `includeThinking` and `includeToolCalls` require `stream: true`. (6) `includeThinking` and `includeToolCalls` require the `X-Sim-Stream-Protocol: agent-events-v1` request header, which declares that the client understands agent-event frames.'

/**
 * Strict public execute body. Async is body-selected (`async: true`) — v2 has
 * no `X-Execution-Mode`/`X-Stream-Response` headers. Internal caller facts
 * (triggerType, draft state, deployment pinning) are NEVER wire fields; they
 * are typed options on the execution service.
 *
 * The six rejected option combinations are enumerated in
 * {@link EXECUTE_OPTION_CONSTRAINTS} and enforced by the route after parsing.
 */
export const v2ExecuteWorkflowBodySchema = z
  .object({
    input: z
      .record(z.string(), z.unknown().describe('Value supplied for one workflow input field.'))
      .optional()
      .describe('Workflow input keyed by deployed trigger input-field name.'),
    async: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        'Queue the run and return a 202 receipt when true. Requires an API key, cannot be combined with `stream`, and rejects all streaming and output-shaping options (`selectedOutputs`, `includeThinking`, `includeToolCalls`, `includeFileBase64`, `base64MaxBytes`).'
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
        "Requested server-side timeout for an asynchronous run, in seconds. This is an upper bound on the request, not the effective timeout: the run uses the smaller of this value and the account plan's execution timeout, so requesting more than the plan allows silently yields the plan timeout with no warning. Rejected with 400 unless `async` is true."
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
        'Block output references to include in a streamed response. Rejected when `async` is true.'
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
      .describe('Inline eligible output files as base64 content.'),
    /** Caps inline base64 file hydration; bounded (v1 leaves it unbounded). */
    base64MaxBytes: z
      .number()
      .int()
      .positive()
      .max(10 * 1024 * 1024)
      .optional()
      .describe('Maximum total bytes of file content to inline as base64.'),
  })
  .strict()
  .meta({
    id: 'ExecuteWorkflowRequest',
    title: 'Execute workflow request',
    description: `Input and execution-mode options for a deployed workflow. ${EXECUTE_OPTION_CONSTRAINTS}`,
    examples: [
      { input: { ticketId: 'ticket_123' } },
      { input: { ticketId: 'ticket_123' }, async: true },
      { input: { ticketId: 'ticket_123' }, stream: true },
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
      'Synchronous workflow run output and in-band execution status. Run failures are reported in band, not as HTTP errors — a synchronous run that exceeds its execution timeout returns HTTP 200 with `status: "failed"` and `error.code: "TIMEOUT"`, so always branch on `status` rather than on the HTTP status alone.',
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
  path: '/api/v2/workflows/[id]/execute',
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
  path: '/api/v2/workflows/[id]/runs/[runId]/resume',
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
  'Current or terminal run status. `redacting` is transient, reported while the output of a finished run is being scrubbed. `paused` means the run is not executing and is waiting to be resumed: either held at a human-in-the-loop pause point, or left paused because a resume attempt did not run to completion. The status alone does not say which. On the single-run response `paused.automaticResumeWaitingReason` distinguishes them: it is recorded whenever a resume attempt fails and cleared once a resume succeeds, so a null value means the run is waiting on human input. When the failure is not retryable or the automatic retries are exhausted, the reason is prefixed `Automatic resume requires manual intervention: `. Run-list items carry no `paused` object, so the two cases are indistinguishable there.'

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
    startDate: z
      .string()
      .datetime()
      .optional()
      .describe('Include runs started at or after this ISO 8601 timestamp.'),
    endDate: z
      .string()
      .datetime()
      .optional()
      .describe('Include runs started at or before this ISO 8601 timestamp.'),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .default(50)
      .describe('Maximum workflow runs to return per page.'),
    cursor: z
      .string()
      .min(1, 'cursor cannot be empty')
      .optional()
      .describe('Opaque pagination cursor returned by a previous request.'),
    /**
     * Deliberate deviation from the v2 `sortBy` + `sortOrder` convention. Runs
     * have exactly one sortable column (start time), so there is no `sortBy` to
     * pair with, and the run cursor is a keyset minted over `order`. Renaming or
     * aliasing the param would require a route change and would introduce a
     * second spelling with undefined precedence when both are sent — so the
     * deviation is documented rather than papered over.
     */
    order: z
      .enum(['asc', 'desc'])
      .optional()
      .default('desc')
      .describe(
        'Sort direction by run start time. This operation deviates from the v2 `sortBy` + `sortOrder` convention: runs are sortable only by start time, so the direction is carried by this single `order` param and `sortBy`/`sortOrder` are not accepted.'
      ),
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
  path: '/api/v2/workflows/[id]/runs',
  params: v2WorkflowIdParamsSchema,
  query: v2ListWorkflowRunsQuerySchema,
  response: {
    mode: 'json',
    schema: v2CursorListResponse(v2WorkflowRunListItemSchema),
  },
})

/**
 * The polled run resource. `queued` is backfilled from the async job
 * queue before the worker writes the durable log row — v1's jobs endpoint 404
 * window doesn't exist here. `error` is the same structured object the execute
 * response carries.
 */
export const v2WorkflowRunStatusSchema = z
  .object({
    runId: v2WorkflowRunIdSchema,
    workflowId: z.string().describe('Workflow that produced the run.'),
    status: v2WorkflowRunStatusValueSchema,
    trigger: z.string().nullable().describe('Trigger type, or null before the run is recorded.'),
    startedAt: z
      .string()
      .nullable()
      .describe('ISO 8601 start timestamp, or null while queued.')
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
      .describe('Structured execution failure, or null when none occurred.'),
    /** Populated only with `includeOutput=true` on completed runs. */
    output: z
      .unknown()
      .describe('Final workflow output value.')
      .nullable()
      .describe('Final workflow output when requested, otherwise null.'),
    blockOutputs: z
      .record(z.string(), z.unknown().describe('Output value produced by one workflow block.'))
      .nullable()
      .describe('Selected block outputs when requested, otherwise null.'),
  })
  .meta({
    id: 'WorkflowRunStatus',
    title: 'Workflow run status',
    description: 'Detailed current state of a workflow run.',
  })
export type V2WorkflowRunStatus = z.output<typeof v2WorkflowRunStatusSchema>

export const v2GetWorkflowRunContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/workflows/[id]/runs/[runId]',
  params: v2WorkflowRunParamsSchema,
  query: workflowExecutionStatusQuerySchema
    .extend({
      includeOutput: workflowExecutionStatusQuerySchema.shape.includeOutput.describe(
        'Include final and block outputs when true.'
      ),
      selectedOutputs: workflowExecutionStatusQuerySchema.shape.selectedOutputs.describe(
        'Comma-separated block output references to include.'
      ),
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
    durablyRecorded: z.boolean().describe('Whether cancellation was recorded durably.'),
    locallyAborted: z.boolean().describe('Whether an in-process execution was aborted.'),
    pausedCancelled: z.boolean().describe('Whether a paused execution was cancelled.'),
    /**
     * Always emitted by the cancellation service — it is not a partial-failure
     * marker. `recorded` is the full-success value; the other four name the step
     * that degraded.
     */
    reason: cancelWorkflowExecutionReasonSchema
      .optional()
      .describe(
        'Machine-readable cancellation outcome. Present on every cancellation, including full successes — it is not a partial-failure marker. `recorded` means cancellation was durably recorded (the normal success value). `redis_unavailable` and `redis_write_failed` mean the distributed cancellation signal could not be written, so an already-running execution may not observe the cancellation. `paused_event_publish_failed` and `paused_database_cancel_failed` name the failing step when cancelling a paused human-in-the-loop run.'
      ),
  })
  .meta({
    id: 'CancelWorkflowRunResult',
    title: 'Cancel workflow run result',
    description:
      'Outcome of a workflow run cancellation request. Cancelling a run that has already reached a terminal state (completed, failed, or cancelled) succeeds with no effect rather than returning an error — treat this endpoint as best-effort and poll the run to observe the final state.',
  })
export type V2CancelWorkflowRunData = z.output<typeof v2CancelWorkflowRunDataSchema>

export const v2CancelWorkflowRunContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/workflows/[id]/runs/[runId]/cancel',
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
  path: '/api/v2/workflows/[id]/export',
  params: v2WorkflowIdParamsSchema,
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
    status: 201,
  },
})
