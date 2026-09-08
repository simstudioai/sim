import { omit } from '@sim/utils/object'
import {
  v2DeleteWorkflowChatDeploymentContract,
  v2GetWorkflowChatDeploymentContract,
  v2ListChatDeploymentsContract,
  v2ReplaceWorkflowChatDeploymentContract,
} from '@/lib/api/contracts/v2/chat-deployments'
import {
  documentedSchema,
  ERROR_RESPONSES,
  type ErrorResponseId,
  FOLDER_TREE_TOO_LARGE,
  FULL_SET_LIST,
  HEAD_MIRRORS_GET,
  HEAD_OMITS_PAYLOAD_HEADERS,
  RATE_LIMIT_HEADERS,
  RESOURCE_CONFLICT_ERRORS,
  RESOURCE_ERRORS,
  RESOURCE_MUTATION_ERRORS,
  RUN_RETENTION,
  V2_AUTH_SECURITY,
  V2_AUTH_SECURITY_SCHEMES,
  V2_BINARY_DOWNLOAD_HEADERS,
  V2_COMMON_HEADERS,
  V2_ERROR_SCHEMA,
  WORKSPACE_API_KEY_DENIED,
  WORKSPACE_ERRORS,
  withRequestBodyErrors,
} from '@/lib/api/contracts/v2/openapi/shared'
import {
  EXECUTE_OPTION_CONSTRAINTS,
  v2ActivateWorkflowVersionContract,
  v2ApplyWorkflowOperationsContract,
  v2ApplyWorkflowVariablesContract,
  v2CancelWorkflowRunContract,
  v2CreateWorkflowContract,
  v2CreateWorkflowFolderContract,
  v2DeleteWorkflowContract,
  v2DeleteWorkflowFolderContract,
  v2DeployWorkflowContract,
  v2DownloadRunFileContract,
  v2DuplicateWorkflowContract,
  v2ExecuteWorkflowContract,
  v2ExecuteWorkflowQueuedResponseSchema,
  v2ExecuteWorkflowSyncResponseSchema,
  v2ExportWorkflowContract,
  v2GetWorkflowContract,
  v2GetWorkflowDeploymentContract,
  v2GetWorkflowRunContract,
  v2GetWorkflowStateContract,
  v2GetWorkflowVersionContract,
  v2ImportWorkflowContract,
  v2ListWorkflowFoldersContract,
  v2ListWorkflowRunsContract,
  v2ListWorkflowsContract,
  v2ListWorkflowVersionsContract,
  v2MoveWorkflowsContract,
  v2RelocateWorkflowFolderContract,
  v2ReplaceWorkflowStateContract,
  v2RestoreWorkflowContract,
  v2ResumeWorkflowContract,
  v2ResumeWorkflowQueuedResponseSchema,
  v2ResumeWorkflowSyncResponseSchema,
  v2RevertWorkflowVersionContract,
  v2RollbackWorkflowContract,
  v2UndeployWorkflowContract,
  v2UpdateWorkflowContract,
  v2UpdateWorkflowPublicApiContract,
  v2UpdateWorkflowVersionContract,
} from '@/lib/api/contracts/v2/workflows'
import {
  defineOpenApiDocument,
  defineOpenApiRoute,
  type OpenApiOperationMetadata,
} from '@/lib/api/openapi/types'
import { chatDeploymentOperations } from '@/lib/chat-deployments/application/operations'
import { workflowOperations } from '@/lib/workflows/application/operations'

const WORKSPACE_ID = 'a91c4b2e-6d3f-4e8a-b5c7-0d9e2f1a8c64'
const WORKFLOW_ID = '3b1f7c92-8d4e-4a6b-9c0d-5e2f8a714b36'
const RUN_ID = 'run_8f14e45f-ceea-467f-a'

const WORKFLOW_EXAMPLE = {
  id: WORKFLOW_ID,
  webUrl: `https://www.sim.ai/workspace/${WORKSPACE_ID}/w/${WORKFLOW_ID}`,
  name: 'Customer support triage',
  description: 'Routes incoming support requests to the right team.',
  folderPath: '/Operations',
  workspaceId: WORKSPACE_ID,
  isDeployed: true,
  deployedAt: '2026-06-12T10:30:00.000Z',
  runCount: 42,
  lastRunAt: '2026-08-09T18:04:11.000Z',
  createdAt: '2026-05-01T09:00:00.000Z',
  updatedAt: '2026-08-09T18:04:11.000Z',
} as const

const WORKFLOW_FOLDER_EXAMPLE = {
  name: 'Operations',
  path: '/Operations',
  parentPath: '/',
  createdAt: '2026-05-01T09:00:00.000Z',
  updatedAt: '2026-05-01T09:00:00.000Z',
  locked: false,
} as const

/** An empty lint report, for examples where the findings are not the subject. */
const EMPTY_LINT_EXAMPLE = {
  sources: [],
  sinks: [],
  orphanBlocks: [],
  emptyOutgoingPorts: [],
  invalidBranchPorts: [],
  invalidConnectionTargets: [],
  fieldIssues: [],
  unresolvedReferences: [],
  notes: [],
} as const

const WORKFLOW_VERSION_EXAMPLE = {
  id: 'version_3',
  version: 3,
  name: 'Escalation routing',
  description: 'Adds the priority escalation branch.',
  isActive: true,
  createdAt: '2026-06-12T10:30:00.000Z',
  deployedBy: 'Jane Smith',
  latestOperationStatus: 'active',
} as const

/**
 * The one confusable pair on this surface: `/workflows/{workflowId}/deployment`
 * (singular) is the workflow's own API deployment, `/workflows/{workflowId}/deployments/chat`
 * is one surface it is served on. Stated on both rather than on whichever the
 * caller happens to open first.
 */
const WORKFLOW_DEPLOYMENT_VS_CHAT =
  '`/workflows/{workflowId}/deployment` controls overall API executability; `/deployments/chat` controls only the hosted-chat surface. A workflow can remain deployed without a chat.'

const CHAT_VS_WORKFLOW_DEPLOYMENT =
  '`/workflows/{workflowId}/deployment` controls API execution; this singleton path controls hosted chat. `PUT` creates or replaces it without a chat-id path.'

const CHAT_DEPLOYMENT_EXAMPLE = {
  id: 'chat_01J8ZK3QW4M6X2R9T7B5C0V2',
  workflowId: WORKFLOW_ID,
  workspaceId: '9f4c2a10-3b7e-4d58-8f6a-2c1d0e5b7a94',
  identifier: 'support',
  url: 'https://sim.ai/chat/support',
  title: 'Support chat',
  description: 'Ask about billing, onboarding, or outages.',
  isActive: true,
  authType: 'public',
  hasPassword: false,
  allowedEmails: [],
  customizations: { primaryColor: '#6F3DFA', welcomeMessage: 'Hi there! How can I help?' },
  outputConfigs: [{ blockId: 'block_01J8ZK3QW4M6X2R9T7B5C0V4', path: 'content' }],
  includeThinking: false,
  includeToolCalls: false,
  createdAt: '2026-06-12T10:30:00.000Z',
  updatedAt: '2026-06-12T10:30:00.000Z',
} as const

/** The list projection: {@link CHAT_DEPLOYMENT_EXAMPLE} without the fields the detail read gates. */
const CHAT_DEPLOYMENT_LIST_ITEM_EXAMPLE = omit(CHAT_DEPLOYMENT_EXAMPLE, [
  'allowedEmails',
  'hasPassword',
  'customizations',
])

const WORKFLOW_GRAPH_EXAMPLE = {
  blocks: {},
  edges: [],
  loops: {},
  parallels: {},
  variables: {},
} as const

const RUN_RESULT_EXAMPLE = {
  data: {
    runId: RUN_ID,
    workflowId: WORKFLOW_ID,
    status: 'completed',
    output: { result: 'Ticket routed to Support' },
    error: null,
    startedAt: '2026-08-09T18:04:10.000Z',
    endedAt: '2026-08-09T18:04:11.000Z',
    durationMs: 1_000,
  },
} as const

const QUEUED_RUN_EXAMPLE = {
  data: {
    runId: RUN_ID,
    statusUrl: `https://www.sim.ai/api/v2/workflows/${WORKFLOW_ID}/runs/${RUN_ID}`,
  },
} as const

type WorkflowOperationInput = Omit<OpenApiOperationMetadata, 'tags' | 'errors'> & {
  errors: readonly ErrorResponseId[]
}

function workflowOperation(operation: WorkflowOperationInput): OpenApiOperationMetadata {
  return { ...operation, tags: ['Workflows'] }
}

function workflowRunOperation(operation: WorkflowOperationInput): OpenApiOperationMetadata {
  return { ...operation, tags: ['Workflow Runs'] }
}

function jsonSuccess(description: string): OpenApiOperationMetadata['success'] {
  return { description, headers: RATE_LIMIT_HEADERS }
}

const executeSyncResponseSchema = documentedSchema(
  v2ExecuteWorkflowSyncResponseSchema,
  'ExecuteWorkflowSyncResponse',
  'Synchronous workflow execution response',
  'Completed, failed, paused, or cancelled synchronous workflow run.',
  [RUN_RESULT_EXAMPLE]
)

const executeQueuedResponseSchema = documentedSchema(
  v2ExecuteWorkflowQueuedResponseSchema,
  'ExecuteWorkflowQueuedResponse',
  'Queued workflow execution response',
  'Receipt returned for an asynchronous workflow run.',
  [QUEUED_RUN_EXAMPLE]
)

const resumeSyncResponseSchema = documentedSchema(
  v2ResumeWorkflowSyncResponseSchema,
  'ResumeWorkflowSyncResponse',
  'Synchronous workflow resume response',
  'Completed, failed, paused, or cancelled resumed workflow run.',
  [RUN_RESULT_EXAMPLE]
)

const resumeQueuedResponseSchema = documentedSchema(
  v2ResumeWorkflowQueuedResponseSchema,
  'ResumeWorkflowQueuedResponse',
  'Queued workflow resume response',
  'Receipt returned when a resumed workflow attempt is queued.',
  [QUEUED_RUN_EXAMPLE]
)

const declaredRoutes = [
  defineOpenApiRoute(
    v2ListWorkflowsContract,
    workflowOperation({
      applicationOperation: workflowOperations.list,
      operationId: 'listWorkflows',
      summary: 'List Workflows',
      description: `List workflows in a workspace with lifecycle scope, folder and deployment filters, search, sorting, and opaque cursor pagination. \`scope\` defaults to \`active\`; pass \`archived\` to list workflows a \`DELETE\` archived. ${FOLDER_TREE_TOO_LARGE}`,
      errors: [...WORKSPACE_ERRORS, 'NotFound', 'PayloadTooLarge'],
      success: jsonSuccess('A page of workflows.'),
    }),
    {
      query: v2ListWorkflowsContract.query,
      response: documentedSchema(
        v2ListWorkflowsContract.response.schema,
        'WorkflowListResponse',
        'Workflow list response',
        'A cursor-paginated page of workflow summaries.',
        [{ data: [WORKFLOW_EXAMPLE], nextCursor: null }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2CreateWorkflowContract,
    workflowOperation({
      applicationOperation: workflowOperations.create,
      operationId: 'createWorkflowV2',
      summary: 'Create Workflow',
      description: `Create a workflow in a workspace root or canonical workflow folder. The response carries the blocks the platform seeded the workflow with, so the start block's id is available without a second request — attach edges to it directly. ${FOLDER_TREE_TOO_LARGE}`,
      errors: [...WORKSPACE_ERRORS, 'NotFound', 'Conflict', 'Locked', 'PayloadTooLarge'],
      success: jsonSuccess('The created workflow.'),
    }),
    {
      query: v2CreateWorkflowContract.query,
      body: v2CreateWorkflowContract.body,
      response: documentedSchema(
        v2CreateWorkflowContract.response.schema,
        'CreateWorkflowResponse',
        'Create workflow response',
        'The created workflow and the blocks it was seeded with.',
        [
          {
            data: {
              ...WORKFLOW_EXAMPLE,
              isDeployed: false,
              deployedAt: null,
              runCount: 0,
              lastRunAt: null,
              blocks: [{ id: 'start-1', type: 'starter', name: 'Start' }],
            },
          },
        ]
      ),
    }
  ),
  defineOpenApiRoute(
    v2GetWorkflowStateContract,
    workflowOperation({
      applicationOperation: workflowOperations.read,
      operationId: 'getWorkflowState',
      summary: 'Get Workflow State',
      description:
        'Get the editable draft graph: blocks, edges, derived loop and parallel containers, and variables. This pollable read records no audit event, and `HEAD` mirrors `GET`. The unsanitized payload includes workspace-scoped credential, knowledge-base, and table ids, so it is not portable. Use `export` for a sanitized copy, but not for read-modify-write because credential bindings are removed. Returned keys exactly match what `PUT /workflows/{workflowId}/state` accepts.',
      /**
       * No `413`: unlike the workflow reads beside it this one resolves no
       * folder path, so it never materializes the workspace's folder tree, and
       * a documented status the operation cannot emit is worse than none. The
       * graph itself is bounded on the write side.
       */
      errors: RESOURCE_ERRORS,
      success: jsonSuccess('The workflow draft graph.'),
    }),
    {
      params: v2GetWorkflowStateContract.params,
      query: v2GetWorkflowStateContract.query,
      response: documentedSchema(
        v2GetWorkflowStateContract.response.schema,
        'WorkflowStateResponse',
        'Workflow state response',
        'The editable draft graph of a workflow.',
        [{ data: WORKFLOW_GRAPH_EXAMPLE }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2ReplaceWorkflowStateContract,
    workflowOperation({
      applicationOperation: workflowOperations.replaceState,
      operationId: 'replaceWorkflowState',
      summary: 'Replace Workflow State',
      description:
        'Atomically replace the editable draft graph. Concurrent writes are row-locked and last-write-wins; no partial state is stored. `loops` and `parallels` are recomputed from `blocks`; omitted `variables` remain unchanged. Foreign ids return `409`. This leaves deployment unchanged and marks the draft for redeployment; lint is advisory. `dryRun=true` runs the same validation, lint, and conflict checks without persistence, audit, or notification; `needsRedeployment` reflects pre-write state. Workspace keys are rejected; use personal keys or OAuth.',
      errors: RESOURCE_MUTATION_ERRORS,
      success: jsonSuccess('The draft graph was replaced.'),
    }),
    {
      params: v2ReplaceWorkflowStateContract.params,
      query: documentedSchema(
        v2ReplaceWorkflowStateContract.query,
        'ReplaceWorkflowStateQuery',
        'Replace workflow state query',
        'Whether to validate without persisting.'
      ),
      body: v2ReplaceWorkflowStateContract.body,
      response: documentedSchema(
        v2ReplaceWorkflowStateContract.response.schema,
        'ReplaceWorkflowStateResponse',
        'Replace workflow state response',
        'Outcome of replacing a workflow draft graph.',
        [
          {
            data: {
              id: WORKFLOW_ID,
              warnings: [],
              needsRedeployment: true,
              dryRun: false,
              lint: EMPTY_LINT_EXAMPLE,
            },
          },
        ]
      ),
    }
  ),
  defineOpenApiRoute(
    v2ApplyWorkflowOperationsContract,
    workflowOperation({
      applicationOperation: workflowOperations.applyOperations,
      operationId: 'applyWorkflowOperations',
      summary: 'Apply Workflow Operations',
      description:
        'Apply graph edits and optional block enablement atomically. Failed operations appear in `skipped`; `deferred` edges resolve when targets exist and must not be retried. With `atomic`, any skip or dropped input returns `409` with `OPERATIONS_NOT_APPLIED` and persists nothing. Non-UUID labels are minted and same-batch references remapped in `mintedBlockIds`. Lint is advisory. `dryRun=true` runs the same checks without persistence, audit, or notification. This changes only the draft. Workspace keys are rejected; use personal keys or OAuth.',
      errors: RESOURCE_MUTATION_ERRORS,
      success: jsonSuccess('The batch was applied.'),
    }),
    {
      params: v2ApplyWorkflowOperationsContract.params,
      query: documentedSchema(
        v2ApplyWorkflowOperationsContract.query,
        'ApplyWorkflowOperationsQuery',
        'Apply workflow operations query',
        'Whether to evaluate without persisting.'
      ),
      body: v2ApplyWorkflowOperationsContract.body,
      response: documentedSchema(
        v2ApplyWorkflowOperationsContract.response.schema,
        'ApplyWorkflowOperationsResponse',
        'Apply workflow operations response',
        'Outcome of a batch of semantic edits.',
        [
          {
            data: {
              id: WORKFLOW_ID,
              applied: 1,
              skipped: [],
              deferred: [],
              inputValidationErrors: [],
              mintedBlockIds: { triage: 'a3f1c0b2-7a44-4c1d-9d3a-2b8e5f0a1c77' },
              lint: {
                sources: [],
                sinks: [],
                orphanBlocks: [],
                emptyOutgoingPorts: [],
                invalidBranchPorts: [],
                invalidConnectionTargets: [],
                fieldIssues: [
                  {
                    blockId: 'agent-1',
                    blockName: 'Triage',
                    blockType: 'agent',
                    missingRequiredFields: ['systemPrompt'],
                    inactiveModeValues: [],
                  },
                ],
                unresolvedReferences: [],
                notes: [],
              },
              warnings: [],
              needsRedeployment: true,
              dryRun: false,
            },
          },
        ]
      ),
    }
  ),
  defineOpenApiRoute(
    v2ApplyWorkflowVariablesContract,
    workflowOperation({
      applicationOperation: workflowOperations.applyVariableOperations,
      operationId: 'applyWorkflowVariables',
      summary: 'Update Workflow Variables',
      description:
        'Add, edit, and delete a workflow\u2019s variables. Operations are matched by variable `name` and applied in order; a batch that changes nothing answers `200` with `changed: false`. Values are coerced to the declared `type`, and a value that cannot be coerced is stored as supplied. Read the current set from `variables` on `GET /workflows/{workflowId}`.',
      errors: RESOURCE_MUTATION_ERRORS,
      success: jsonSuccess('The variable set after the batch.'),
    }),
    {
      params: v2ApplyWorkflowVariablesContract.params,
      query: v2ApplyWorkflowVariablesContract.query,
      body: v2ApplyWorkflowVariablesContract.body,
      response: documentedSchema(
        v2ApplyWorkflowVariablesContract.response.schema,
        'ApplyWorkflowVariablesResponse',
        'Apply workflow variables response',
        'Outcome of a workflow variable update.',
        [{ data: { id: WORKFLOW_ID, variableCount: 3, changed: true } }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2DuplicateWorkflowContract,
    workflowOperation({
      applicationOperation: workflowOperations.duplicate,
      operationId: 'duplicateWorkflow',
      summary: 'Duplicate Workflow',
      description: `Copy a workflow, including its blocks, edges, subflows, and variables, into the same workspace. Omitting \`name\` reuses the source name; a collision inside the destination folder is deduplicated rather than refused. ${FOLDER_TREE_TOO_LARGE}`,
      errors: RESOURCE_MUTATION_ERRORS,
      success: jsonSuccess('The created copy.'),
    }),
    {
      params: v2DuplicateWorkflowContract.params,
      query: v2DuplicateWorkflowContract.query,
      body: v2DuplicateWorkflowContract.body,
      response: documentedSchema(
        v2DuplicateWorkflowContract.response.schema,
        'DuplicateWorkflowResponse',
        'Duplicate workflow response',
        'The created copy.',
        [
          {
            data: {
              ...WORKFLOW_EXAMPLE,
              name: 'Customer support triage (copy)',
              isDeployed: false,
              deployedAt: null,
              runCount: 0,
              lastRunAt: null,
            },
          },
        ]
      ),
    }
  ),
  defineOpenApiRoute(
    v2RestoreWorkflowContract,
    workflowOperation({
      applicationOperation: workflowOperations.restore,
      operationId: 'restoreWorkflow',
      summary: 'Restore Workflow',
      description: `Bring an archived workflow back, along with the schedules, webhooks, MCP tools, and chats that were archived with it. A workflow that is not archived answers \`409\`. A workflow whose folder was archived is restored to the workspace root. ${FOLDER_TREE_TOO_LARGE}`,
      errors: [...RESOURCE_MUTATION_ERRORS, 'PayloadTooLarge'],
      success: jsonSuccess('The restored workflow.'),
    }),
    {
      params: v2RestoreWorkflowContract.params,
      query: v2RestoreWorkflowContract.query,
      response: documentedSchema(
        v2RestoreWorkflowContract.response.schema,
        'RestoreWorkflowResponse',
        'Restore workflow response',
        'The restored workflow.',
        [{ data: WORKFLOW_EXAMPLE }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2MoveWorkflowsContract,
    workflowOperation({
      applicationOperation: workflowOperations.moveBulk,
      operationId: 'moveWorkflows',
      summary: 'Move Workflows',
      description: `Relocate up to 100 workflows into one folder. Explicitly best-effort: each workflow moves in its own transaction, and one that is absent from the workspace, archived, or locked lands in \`failed\` while the rest still move. Duplicate ids are collapsed. ${FOLDER_TREE_TOO_LARGE}`,
      errors: [...WORKSPACE_ERRORS, 'NotFound'],
      success: jsonSuccess('Which workflows moved and which did not.'),
    }),
    {
      query: v2MoveWorkflowsContract.query,
      body: v2MoveWorkflowsContract.body,
      response: documentedSchema(
        v2MoveWorkflowsContract.response.schema,
        'MoveWorkflowsResponse',
        'Move workflows response',
        'Which workflows moved and which did not.',
        [{ data: { moved: [WORKFLOW_ID], failed: [], folderPath: '/Operations' } }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2GetWorkflowContract,
    workflowOperation({
      applicationOperation: workflowOperations.read,
      operationId: 'getWorkflow',
      summary: 'Get Workflow',
      description: `Get a workflow with its variables and deployed API-trigger inputs. ${FOLDER_TREE_TOO_LARGE}`,
      errors: [...RESOURCE_ERRORS, 'PayloadTooLarge'],
      success: jsonSuccess('The requested workflow.'),
    }),
    {
      params: v2GetWorkflowContract.params,
      query: v2GetWorkflowContract.query,
      response: documentedSchema(
        v2GetWorkflowContract.response.schema,
        'WorkflowDetailResponse',
        'Workflow detail response',
        'Detailed workflow metadata, variables, and trigger inputs.',
        [{ data: { ...WORKFLOW_EXAMPLE, variables: {}, inputs: [] } }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2UpdateWorkflowContract,
    workflowOperation({
      applicationOperation: workflowOperations.update,
      operationId: 'updateWorkflowV2',
      summary: 'Update Workflow',
      description: `Rename, describe, or move a workflow to a canonical folder path. ${FOLDER_TREE_TOO_LARGE}`,
      errors: [...RESOURCE_MUTATION_ERRORS, 'PayloadTooLarge'],
      success: jsonSuccess('The updated workflow.'),
    }),
    {
      query: v2UpdateWorkflowContract.query,
      params: v2UpdateWorkflowContract.params,
      body: v2UpdateWorkflowContract.body,
      response: documentedSchema(
        v2UpdateWorkflowContract.response.schema,
        'UpdateWorkflowResponse',
        'Update workflow response',
        'The updated workflow summary.',
        [{ data: WORKFLOW_EXAMPLE }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2DeleteWorkflowContract,
    workflowOperation({
      applicationOperation: workflowOperations.delete,
      operationId: 'deleteWorkflowV2',
      summary: 'Delete Workflow',
      description:
        'Archive a workflow. Despite the verb, this is not an erasure: the workflow, and the schedules, webhooks, MCP tools, and chats attached to it, are stamped archived and stop running, and `POST /workflows/{workflowId}/restore` brings all of them back. An archived workflow disappears from the default list and is reachable with `scope=archived`. The `deleted` field is retained for shipped clients; `archived` states what actually happened.',
      errors: [...RESOURCE_ERRORS, 'Locked'],
      success: jsonSuccess('The workflow was archived.'),
    }),
    {
      query: v2DeleteWorkflowContract.query,
      params: v2DeleteWorkflowContract.params,
      response: documentedSchema(
        v2DeleteWorkflowContract.response.schema,
        'DeleteWorkflowResponse',
        'Delete workflow response',
        'Confirmation that the workflow was archived.',
        [{ data: { id: WORKFLOW_ID, deleted: true, archived: true } }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2ListWorkflowVersionsContract,
    workflowOperation({
      applicationOperation: workflowOperations.listVersions,
      operationId: 'listWorkflowVersionsV2',
      summary: 'List Workflow Versions',
      description: 'List immutable deployment versions of a workflow, newest first.',
      errors: RESOURCE_ERRORS,
      success: jsonSuccess('A page of deployment versions.'),
    }),
    {
      params: v2ListWorkflowVersionsContract.params,
      query: v2ListWorkflowVersionsContract.query,
      response: documentedSchema(
        v2ListWorkflowVersionsContract.response.schema,
        'WorkflowVersionListResponse',
        'Workflow version list response',
        'A cursor-paginated page of deployment versions.',
        [{ data: [WORKFLOW_VERSION_EXAMPLE], nextCursor: null }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2GetWorkflowVersionContract,
    workflowOperation({
      applicationOperation: workflowOperations.readVersion,
      operationId: 'getWorkflowVersionV2',
      summary: 'Get Workflow Version',
      description: 'Get an immutable deployment version and its pinned workflow graph snapshot.',
      errors: RESOURCE_ERRORS,
      success: jsonSuccess('The requested deployment version.'),
    }),
    {
      query: v2GetWorkflowVersionContract.query,
      params: v2GetWorkflowVersionContract.params,
      response: documentedSchema(
        v2GetWorkflowVersionContract.response.schema,
        'WorkflowVersionDetailResponse',
        'Workflow version detail response',
        'The deployment version and its pinned workflow graph.',
        [
          {
            data: {
              id: WORKFLOW_VERSION_EXAMPLE.id,
              version: WORKFLOW_VERSION_EXAMPLE.version,
              name: WORKFLOW_VERSION_EXAMPLE.name,
              description: WORKFLOW_VERSION_EXAMPLE.description,
              isActive: WORKFLOW_VERSION_EXAMPLE.isActive,
              createdAt: WORKFLOW_VERSION_EXAMPLE.createdAt,
              state: { blocks: {}, edges: [] },
            },
          },
        ]
      ),
    }
  ),
  defineOpenApiRoute(
    v2UpdateWorkflowVersionContract,
    workflowOperation({
      applicationOperation: workflowOperations.updateVersion,
      operationId: 'updateWorkflowVersionV2',
      summary: 'Update Workflow Version',
      description:
        'Relabel a deployment version. Merge-patch shaped: an omitted key is unchanged and `description: null` clears the release note. Metadata only — the pinned graph is immutable, and this never changes which version is live. Promote a version with `POST /workflows/{workflowId}/versions/{version}/activate`.',
      errors: RESOURCE_ERRORS,
      success: jsonSuccess('The updated version metadata.'),
    }),
    {
      query: v2UpdateWorkflowVersionContract.query,
      params: v2UpdateWorkflowVersionContract.params,
      body: v2UpdateWorkflowVersionContract.body,
      response: documentedSchema(
        v2UpdateWorkflowVersionContract.response.schema,
        'UpdateWorkflowVersionResponse',
        'Update workflow version response',
        'The deployment version metadata after the update.',
        [
          {
            data: {
              version: WORKFLOW_VERSION_EXAMPLE.version,
              name: WORKFLOW_VERSION_EXAMPLE.name,
              description: WORKFLOW_VERSION_EXAMPLE.description,
            },
          },
        ]
      ),
    }
  ),
  defineOpenApiRoute(
    v2ActivateWorkflowVersionContract,
    workflowOperation({
      applicationOperation: workflowOperations.activateVersion,
      operationId: 'activateWorkflowVersion',
      summary: 'Activate Workflow Version',
      description: `Promote an existing deployment version to live. Activation is asynchronous; inspect \`isDeployed\` and \`latestDeploymentAttempt\` for current state. Unlike \`rollback\`, the target is named by the path and the workflow need not already be deployed. ${WORKSPACE_API_KEY_DENIED}`,
      errors: [...RESOURCE_ERRORS, 'Conflict', 'PayloadTooLarge', 'Locked'],
      success: jsonSuccess('The accepted activation attempt.'),
    }),
    {
      query: v2ActivateWorkflowVersionContract.query,
      params: v2ActivateWorkflowVersionContract.params,
      body: v2ActivateWorkflowVersionContract.body,
      response: documentedSchema(
        v2ActivateWorkflowVersionContract.response.schema,
        'ActivateWorkflowVersionResponse',
        'Activate workflow version response',
        'Current deployment state after accepting the activation attempt.',
        [
          {
            data: {
              id: WORKFLOW_ID,
              isDeployed: false,
              deployedAt: null,
              warnings: [],
              activeDeployment: null,
              latestDeploymentAttempt: {
                id: 'depop_01J8ZK4RX5N7Y3S0U8D6E1W2',
                deploymentVersionId: 'depver_01J8ZK4RX5N7Y3S0U8D6E1W3',
                version: 3,
                action: 'activate',
                status: 'activating',
                isCurrent: true,
                readiness: { webhooks: 'ready', schedules: 'ready', mcp: 'not_applicable' },
                requestedAt: '2026-06-12T10:30:00.000Z',
                activatedAt: null,
                error: null,
              },
              version: 3,
            },
          },
        ]
      ),
    }
  ),
  defineOpenApiRoute(
    v2RevertWorkflowVersionContract,
    workflowOperation({
      applicationOperation: workflowOperations.revertVersion,
      operationId: 'revertWorkflowVersion',
      summary: 'Revert Workflow To Version',
      description: `Overwrite the editable draft with a deployment version, irreversibly discarding unsaved edits. This does not change the live version; use \`activate\` or \`rollback\` for production, both of which leave the draft unchanged. Pass \`active\` to reset the draft to the live graph. ${WORKSPACE_API_KEY_DENIED}`,
      errors: [...RESOURCE_ERRORS, 'Conflict', 'PayloadTooLarge', 'Locked'],
      success: jsonSuccess('The draft after it was overwritten.'),
    }),
    {
      query: v2RevertWorkflowVersionContract.query,
      params: v2RevertWorkflowVersionContract.params,
      body: v2RevertWorkflowVersionContract.body,
      response: documentedSchema(
        v2RevertWorkflowVersionContract.response.schema,
        'RevertWorkflowVersionResponse',
        'Revert workflow version response',
        'The draft after it was overwritten by the deployment version.',
        [{ data: { id: WORKFLOW_ID, version: 3, lastSaved: 1765535400000 } }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2GetWorkflowDeploymentContract,
    workflowOperation({
      applicationOperation: workflowOperations.read,
      operationId: 'getWorkflowDeployment',
      summary: 'Get Workflow Deployment',
      description: `Read the live version, latest deployment attempt and readiness, draft drift (\`needsRedeployment\`), and \`isPublicApi\`. When \`isPublicApi\` is true, anyone with the execution URL can run and consume billed usage without an API key; change it with \`PATCH /workflows/{workflowId}/deployment\`. ${WORKFLOW_DEPLOYMENT_VS_CHAT}`,
      errors: RESOURCE_ERRORS,
      success: jsonSuccess('The current deployment state.'),
    }),
    {
      query: v2GetWorkflowDeploymentContract.query,
      params: v2GetWorkflowDeploymentContract.params,
      response: documentedSchema(
        v2GetWorkflowDeploymentContract.response.schema,
        'WorkflowDeploymentResponse',
        'Workflow deployment response',
        'Current deployment state, including draft-versus-live drift and whether the deployment is publicly executable.',
        [
          {
            data: {
              id: WORKFLOW_ID,
              isDeployed: true,
              needsRedeployment: true,
              isPublicApi: false,
              deployedAt: '2026-06-12T10:30:00.000Z',
              warnings: [],
              activeDeployment: {
                deploymentVersionId: 'depver_01J8ZK3QW4M6X2R9T7B5C0V2',
                version: 3,
                deployedAt: '2026-06-12T10:30:00.000Z',
              },
              latestDeploymentAttempt: {
                id: 'depop_01J8ZK3QW4M6X2R9T7B5C0V1',
                deploymentVersionId: 'depver_01J8ZK3QW4M6X2R9T7B5C0V2',
                version: 3,
                action: 'deploy',
                status: 'active',
                isCurrent: true,
                readiness: { webhooks: 'ready', schedules: 'ready', mcp: 'not_applicable' },
                requestedAt: '2026-06-12T10:29:58.000Z',
                activatedAt: '2026-06-12T10:30:00.000Z',
                error: null,
              },
            },
          },
        ]
      ),
    }
  ),
  defineOpenApiRoute(
    v2UpdateWorkflowPublicApiContract,
    workflowOperation({
      applicationOperation: workflowOperations.updatePublicApi,
      operationId: 'updateWorkflowPublicApi',
      summary: 'Update Workflow Public API Access',
      description: `Enable or disable unauthenticated public execution of the deployed workflow. While enabled, anyone holding the execution URL can run the workflow without an API key. An organization that forbids public sharing refuses this with \`403\` and \`PUBLIC_SHARING_NOT_ALLOWED\`. ${WORKFLOW_DEPLOYMENT_VS_CHAT} ${WORKSPACE_API_KEY_DENIED}`,
      errors: [...RESOURCE_ERRORS, 'PayloadTooLarge', 'Locked'],
      success: jsonSuccess('The updated public API setting.'),
    }),
    {
      query: v2UpdateWorkflowPublicApiContract.query,
      params: v2UpdateWorkflowPublicApiContract.params,
      body: v2UpdateWorkflowPublicApiContract.body,
      response: documentedSchema(
        v2UpdateWorkflowPublicApiContract.response.schema,
        'UpdateWorkflowPublicApiResponse',
        'Update workflow public API response',
        'Public API access after the update.',
        [{ data: { id: WORKFLOW_ID, isPublicApi: true } }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2DeployWorkflowContract,
    workflowOperation({
      applicationOperation: workflowOperations.deploy,
      operationId: 'deployWorkflow',
      summary: 'Deploy Workflow',
      description: `Create and asynchronously activate a deployment version. Not idempotent: every call mints a new version, so a retry after a timeout creates a second one. A deployment that would conflict with an existing webhook path is a \`409\`. ${WORKSPACE_API_KEY_DENIED}`,
      errors: [...RESOURCE_ERRORS, 'Conflict', 'PayloadTooLarge', 'Locked'],
      success: jsonSuccess('The accepted deployment attempt.'),
    }),
    {
      query: v2DeployWorkflowContract.query,
      params: v2DeployWorkflowContract.params,
      body: v2DeployWorkflowContract.body,
      response: documentedSchema(
        v2DeployWorkflowContract.response.schema,
        'DeployWorkflowResponse',
        'Deploy workflow response',
        'Current deployment state after accepting the attempt.',
        [
          {
            data: {
              id: WORKFLOW_ID,
              isDeployed: false,
              deployedAt: null,
              warnings: [],
              activeDeployment: null,
              latestDeploymentAttempt: {
                id: 'depop_01J8ZK3QW4M6X2R9T7B5C0V1',
                deploymentVersionId: 'depver_01J8ZK3QW4M6X2R9T7B5C0V2',
                version: 3,
                action: 'deploy',
                status: 'preparing',
                isCurrent: true,
                readiness: { webhooks: 'pending', schedules: 'ready', mcp: 'not_applicable' },
                requestedAt: '2026-06-12T10:30:00.000Z',
                activatedAt: null,
                error: null,
              },
              version: 3,
            },
          },
        ]
      ),
    }
  ),
  defineOpenApiRoute(
    v2UndeployWorkflowContract,
    workflowOperation({
      applicationOperation: workflowOperations.undeploy,
      operationId: 'undeployWorkflow',
      summary: 'Undeploy Workflow',
      description: `Deactivate the currently serving workflow version. ${WORKSPACE_API_KEY_DENIED}`,
      errors: [...RESOURCE_ERRORS, 'Locked'],
      success: jsonSuccess('The workflow was undeployed.'),
    }),
    {
      query: v2UndeployWorkflowContract.query,
      params: v2UndeployWorkflowContract.params,
      response: documentedSchema(
        v2UndeployWorkflowContract.response.schema,
        'UndeployWorkflowResponse',
        'Undeploy workflow response',
        'Deployment state after deactivating the active version.',
        [
          {
            data: {
              id: WORKFLOW_ID,
              isDeployed: false,
              deployedAt: null,
              warnings: [],
              activeDeployment: null,
              latestDeploymentAttempt: null,
            },
          },
        ]
      ),
    }
  ),
  defineOpenApiRoute(
    v2RollbackWorkflowContract,
    workflowOperation({
      applicationOperation: workflowOperations.activateVersion,
      operationId: 'rollbackWorkflow',
      summary: 'Rollback Workflow',
      description: `Asynchronously reactivate a previous deployment version, selecting the preceding active version when no version is supplied. Use this to step back from the currently live version; to make a specific version live by naming it in the path — including when the workflow is not currently deployed — use \`POST /workflows/{workflowId}/versions/{version}/activate\`. Neither touches the draft. ${WORKSPACE_API_KEY_DENIED}`,
      errors: [...RESOURCE_ERRORS, 'Conflict', 'PayloadTooLarge', 'Locked'],
      success: jsonSuccess('The accepted rollback attempt.'),
    }),
    {
      query: v2RollbackWorkflowContract.query,
      params: v2RollbackWorkflowContract.params,
      body: v2RollbackWorkflowContract.body,
      response: documentedSchema(
        v2RollbackWorkflowContract.response.schema,
        'RollbackWorkflowResponse',
        'Rollback workflow response',
        'Current deployment state after accepting the rollback attempt.',
        [
          {
            data: {
              id: WORKFLOW_ID,
              isDeployed: false,
              deployedAt: null,
              warnings: [],
              activeDeployment: null,
              latestDeploymentAttempt: {
                id: 'depop_01J8ZK4RX5N7Y3S0U8D6E1W2',
                deploymentVersionId: 'depver_01J8ZK4RX5N7Y3S0U8D6E1W3',
                version: 2,
                action: 'activate',
                status: 'activating',
                isCurrent: true,
                readiness: { webhooks: 'ready', schedules: 'ready', mcp: 'not_applicable' },
                requestedAt: '2026-06-12T10:30:00.000Z',
                activatedAt: null,
                error: null,
              },
              version: 2,
            },
          },
        ]
      ),
    }
  ),
  defineOpenApiRoute(
    v2ExportWorkflowContract,
    workflowOperation({
      applicationOperation: workflowOperations.export,
      operationId: 'exportWorkflow',
      summary: 'Export Workflow',
      description: `Export a portable, secret-sanitized workflow; workspace-scoped bindings must be selected again after import. Exporting records an audit event. ${HEAD_MIRRORS_GET} ${FOLDER_TREE_TOO_LARGE}`,
      errors: [...RESOURCE_ERRORS, 'PayloadTooLarge'],
      success: jsonSuccess('The workflow export payload.'),
    }),
    {
      query: v2ExportWorkflowContract.query,
      params: v2ExportWorkflowContract.params,
      response: documentedSchema(
        v2ExportWorkflowContract.response.schema,
        'ExportWorkflowResponse',
        'Export workflow response',
        'Portable, secret-sanitized workflow data.',
        [
          {
            data: {
              version: '1.0',
              exportedAt: '2026-08-09T18:04:11.000Z',
              workflow: {
                id: WORKFLOW_ID,
                name: WORKFLOW_EXAMPLE.name,
                description: WORKFLOW_EXAMPLE.description,
                workspaceId: WORKSPACE_ID,
                folderPath: '/Operations',
              },
              state: { blocks: {}, edges: [] },
            },
          },
        ]
      ),
    }
  ),
  defineOpenApiRoute(
    v2ImportWorkflowContract,
    workflowOperation({
      applicationOperation: workflowOperations.import,
      operationId: 'importWorkflow',
      summary: 'Import Workflow',
      description: `Create a workflow from a portable export object, bare state, or JSON string. ${FOLDER_TREE_TOO_LARGE}`,
      errors: [...RESOURCE_MUTATION_ERRORS, 'PayloadTooLarge'],
      success: jsonSuccess('The imported workflow.'),
    }),
    {
      query: v2ImportWorkflowContract.query,
      body: v2ImportWorkflowContract.body,
      response: documentedSchema(
        v2ImportWorkflowContract.response.schema,
        'ImportWorkflowResponse',
        'Import workflow response',
        'The workflow created by the import.',
        [
          {
            data: {
              id: WORKFLOW_ID,
              name: WORKFLOW_EXAMPLE.name,
              description: WORKFLOW_EXAMPLE.description,
              workspaceId: WORKSPACE_ID,
              folderPath: '/Operations',
              createdAt: WORKFLOW_EXAMPLE.createdAt,
              updatedAt: WORKFLOW_EXAMPLE.updatedAt,
            },
          },
        ]
      ),
    }
  ),
  defineOpenApiRoute(
    v2ListChatDeploymentsContract,
    workflowOperation({
      applicationOperation: chatDeploymentOperations.list,
      operationId: 'listChatDeployments',
      summary: 'List Chat Deployments',
      description:
        'List hosted chats in a workspace with opaque cursor pagination. Filter by `workflowId` to resolve one workflow’s singleton chat. Each item includes its public URL, whose identifier is a path segment, but omits `allowedEmails`, `hasPassword`, and `customizations`; read those through the admin-only singleton endpoint. This list requires workspace read access and accepts workspace API keys. Stored passwords are never returned.',
      errors: RESOURCE_ERRORS,
      success: jsonSuccess('A page of chat deployments.'),
    }),
    {
      query: v2ListChatDeploymentsContract.query,
      response: documentedSchema(
        v2ListChatDeploymentsContract.response.schema,
        'ChatDeploymentListResponse',
        'Chat deployment list response',
        'A cursor-paginated page of chat deployments.',
        [{ data: [CHAT_DEPLOYMENT_LIST_ITEM_EXAMPLE], nextCursor: null }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2GetWorkflowChatDeploymentContract,
    workflowOperation({
      applicationOperation: chatDeploymentOperations.read,
      operationId: 'getWorkflowChatDeployment',
      summary: 'Get Workflow Chat Deployment',
      description: `Read a workflow’s singleton hosted chat, or return \`404\` when none exists. ${CHAT_VS_WORKFLOW_DEPLOYMENT} The password is never returned; \`hasPassword\` reports its presence. Visitor-gate fields (\`authType\`, \`hasPassword\`, and \`allowedEmails\`) require workspace admin access. ${WORKSPACE_API_KEY_DENIED}`,
      errors: RESOURCE_ERRORS,
      success: jsonSuccess("The workflow's chat deployment."),
    }),
    {
      query: v2GetWorkflowChatDeploymentContract.query,
      params: v2GetWorkflowChatDeploymentContract.params,
      response: documentedSchema(
        v2GetWorkflowChatDeploymentContract.response.schema,
        'GetWorkflowChatDeploymentResponse',
        'Get workflow chat deployment response',
        "The workflow's chat deployment.",
        [{ data: CHAT_DEPLOYMENT_EXAMPLE }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2ReplaceWorkflowChatDeploymentContract,
    workflowOperation({
      applicationOperation: chatDeploymentOperations.replace,
      operationId: 'replaceWorkflowChatDeployment',
      summary: 'Create or Replace Workflow Chat Deployment',
      description: `Create or replace hosted chat. Omitted fields reset to defaults except per-field \`customizations\`. \`password\` is write-only and required for password auth; \`allowedEmails\` is required and non-empty for email or SSO. This also deploys the draft. A duplicate identifier or pending deployment returns \`409\`; public auth exposes the URL. ${CHAT_VS_WORKFLOW_DEPLOYMENT} Workspace keys are rejected; use personal keys or OAuth.`,
      errors: [...RESOURCE_ERRORS, 'Conflict', 'PayloadTooLarge', 'Locked'],
      success: jsonSuccess('The published chat deployment.'),
    }),
    {
      query: v2ReplaceWorkflowChatDeploymentContract.query,
      params: v2ReplaceWorkflowChatDeploymentContract.params,
      body: v2ReplaceWorkflowChatDeploymentContract.body,
      response: documentedSchema(
        v2ReplaceWorkflowChatDeploymentContract.response.schema,
        'ReplaceWorkflowChatDeploymentResponse',
        'Replace workflow chat deployment response',
        'The chat deployment as stored after the replace.',
        [{ data: CHAT_DEPLOYMENT_EXAMPLE }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2DeleteWorkflowChatDeploymentContract,
    workflowOperation({
      applicationOperation: chatDeploymentOperations.delete,
      operationId: 'deleteWorkflowChatDeployment',
      summary: 'Delete Workflow Chat Deployment',
      description: `Stop serving a workflow's hosted chat. Its URL stops answering and the identifier becomes free again. The workflow's own deployment is untouched and stays executable through the workflow API — to undeploy that, use \`DELETE /workflows/{workflowId}/deploy\`. ${WORKSPACE_API_KEY_DENIED}`,
      errors: RESOURCE_ERRORS,
      success: jsonSuccess('The chat deployment was removed.'),
    }),
    {
      query: v2DeleteWorkflowChatDeploymentContract.query,
      params: v2DeleteWorkflowChatDeploymentContract.params,
      response: documentedSchema(
        v2DeleteWorkflowChatDeploymentContract.response.schema,
        'DeleteWorkflowChatDeploymentResponse',
        'Delete workflow chat deployment response',
        'Acknowledgement that the chat deployment was removed.',
        [{ data: { id: CHAT_DEPLOYMENT_EXAMPLE.id, deleted: true } }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2ExecuteWorkflowContract,
    workflowOperation({
      applicationOperation: workflowOperations.execute,
      operationId: 'executeWorkflowV2',
      summary: 'Execute Workflow',
      description: `Execute a deployment or use \`run.source: "manual"\` for draft state. Manual runs require personal or OAuth write access and reject workspace keys, anonymous callers, and async. Start at a trigger or resume from same-workflow \`sourceRunId\`. Public deployments allow anonymous sync or streaming. Request \`application/x-ndjson\` for 15-second heartbeats and final resource. Timeouts return \`200\` with failed status and \`TIMEOUT\`. ${EXECUTE_OPTION_CONSTRAINTS}`,
      errors: [
        'BadRequest',
        'Unauthorized',
        'UsageLimitExceeded',
        'Forbidden',
        'NotFound',
        'RunIdConflict',
        'PayloadTooLarge',
        'RateLimited',
        'ClientClosedRequest',
        'InternalError',
        'ServiceUnavailable',
      ],
      security: [...V2_AUTH_SECURITY, {}],
      success: {
        byStatus: {
          200: {
            description:
              'A synchronous run result, heartbeat-delimited NDJSON result stream, or Server-Sent Event stream.',
            headers: ['X-Run-Id', ...RATE_LIMIT_HEADERS],
            additionalContentTypes: ['application/x-ndjson', 'text/event-stream'],
          },
          202: {
            description: 'The asynchronous run was queued.',
            headers: ['X-Run-Id', ...RATE_LIMIT_HEADERS],
          },
        },
      },
    }),
    {
      query: v2ExecuteWorkflowContract.query,
      params: v2ExecuteWorkflowContract.params,
      headers: v2ExecuteWorkflowContract.headers,
      body: v2ExecuteWorkflowContract.body,
      response: v2ExecuteWorkflowContract.response.schema,
      responses: { 200: executeSyncResponseSchema, 202: executeQueuedResponseSchema },
    }
  ),
  defineOpenApiRoute(
    v2ListWorkflowRunsContract,
    workflowRunOperation({
      applicationOperation: workflowOperations.listRuns,
      operationId: 'listWorkflowRunsV2',
      summary: 'List Workflow Runs',
      description: `List recorded runs of a workflow with filtering and opaque cursor pagination. ${RUN_RETENTION}`,
      errors: RESOURCE_ERRORS,
      success: jsonSuccess('A page of workflow runs.'),
    }),
    {
      params: v2ListWorkflowRunsContract.params,
      query: v2ListWorkflowRunsContract.query,
      response: documentedSchema(
        v2ListWorkflowRunsContract.response.schema,
        'WorkflowRunListResponse',
        'Workflow run list response',
        'A cursor-paginated page of workflow run summaries.',
        [
          {
            data: [
              {
                runId: RUN_ID,
                workflowId: WORKFLOW_ID,
                status: 'completed',
                trigger: 'api',
                startedAt: '2026-08-09T18:04:10.000Z',
                endedAt: '2026-08-09T18:04:11.000Z',
                durationMs: 1_000,
                cost: { total: 12 },
              },
            ],
            nextCursor: null,
          },
        ]
      ),
    }
  ),
  defineOpenApiRoute(
    v2GetWorkflowRunContract,
    workflowRunOperation({
      applicationOperation: workflowOperations.readRun,
      operationId: 'getWorkflowRunV2',
      summary: 'Get Workflow Run',
      description: `Get current run state with optional final and block outputs. With \`includeOutput\`, \`files\` includes download paths; \`includeFileBase64\` reads object storage to inline bytes and returns \`413\` with the download path when one file or the total exceeds 16 MiB. ${HEAD_MIRRORS_GET}`,
      errors: [...RESOURCE_CONFLICT_ERRORS, 'PayloadTooLarge'],
      success: jsonSuccess('The workflow run status.'),
    }),
    {
      params: v2GetWorkflowRunContract.params,
      query: v2GetWorkflowRunContract.query,
      response: documentedSchema(
        v2GetWorkflowRunContract.response.schema,
        'WorkflowRunStatusResponse',
        'Workflow run status response',
        'Detailed current state of a workflow run.',
        [
          {
            data: {
              runId: RUN_ID,
              workflowId: WORKFLOW_ID,
              status: 'completed',
              trigger: 'api',
              startedAt: '2026-08-09T18:04:10.000Z',
              endedAt: '2026-08-09T18:04:11.000Z',
              durationMs: 1_000,
              paused: null,
              cost: { total: 12 },
              error: null,
              output: { result: 'Ticket routed to Support' },
              blockOutputs: null,
              files: [
                {
                  id: 'file_1a2b3c',
                  name: 'summary.pdf',
                  size: 20_480,
                  type: 'application/pdf',
                  downloadPath: `/api/v2/workflows/${WORKFLOW_ID}/runs/${RUN_ID}/files/file_1a2b3c`,
                  base64: null,
                },
              ],
            },
          },
        ]
      ),
    }
  ),
  defineOpenApiRoute(
    v2DownloadRunFileContract,
    workflowRunOperation({
      applicationOperation: workflowOperations.downloadRunFile,
      operationId: 'downloadWorkflowRunFileV2',
      summary: 'Download Workflow Run File',
      description: `Download one run-produced file by id. Downloads record an audit event. ${RUN_RETENTION} ${HEAD_MIRRORS_GET} ${HEAD_OMITS_PAYLOAD_HEADERS}`,
      errors: [...RESOURCE_CONFLICT_ERRORS],
      success: {
        description: 'The run file bytes.',
        headers: [...RATE_LIMIT_HEADERS, 'Content-Type', 'Content-Disposition', 'Content-Length'],
        contentTypes: ['application/octet-stream'],
      },
    }),
    {
      params: v2DownloadRunFileContract.params,
      query: v2DownloadRunFileContract.query,
    }
  ),
  defineOpenApiRoute(
    v2ResumeWorkflowContract,
    workflowRunOperation({
      applicationOperation: workflowOperations.resumeRun,
      operationId: 'resumeWorkflowRunV2',
      summary: 'Resume Workflow Run',
      description:
        'Resume one human-in-the-loop pause context. The resumed attempt receives a new run identifier and may complete synchronously or return a queue receipt.',
      errors: [...RESOURCE_ERRORS, 'UsageLimitExceeded', 'Conflict', 'PayloadTooLarge'],
      success: {
        byStatus: {
          200: {
            description: 'The resumed workflow attempt completed synchronously.',
            headers: ['X-Run-Id', ...RATE_LIMIT_HEADERS],
          },
          202: {
            description: 'The resumed workflow attempt was queued.',
            headers: ['X-Run-Id', ...RATE_LIMIT_HEADERS],
          },
        },
      },
    }),
    {
      query: v2ResumeWorkflowContract.query,
      params: v2ResumeWorkflowContract.params,
      body: v2ResumeWorkflowContract.body,
      response: v2ResumeWorkflowContract.response.schema,
      responses: { 200: resumeSyncResponseSchema, 202: resumeQueuedResponseSchema },
    }
  ),
  defineOpenApiRoute(
    v2CancelWorkflowRunContract,
    workflowRunOperation({
      applicationOperation: workflowOperations.cancelRun,
      operationId: 'cancelRunV2',
      summary: 'Cancel Workflow Run',
      description:
        'Request cancellation of a running, queued, or paused workflow run. Cancelling a run already in a terminal state succeeds with no effect. A run produced by a table workflow group is a `409` when its cell can no longer accept the cancellation.',
      errors: RESOURCE_CONFLICT_ERRORS,
      success: jsonSuccess('The cancellation outcome.'),
    }),
    {
      query: v2CancelWorkflowRunContract.query,
      params: v2CancelWorkflowRunContract.params,
      response: documentedSchema(
        v2CancelWorkflowRunContract.response.schema,
        'CancelWorkflowRunResponse',
        'Cancel workflow run response',
        'Outcome of the cancellation request.',
        [
          {
            data: {
              success: true,
              runId: RUN_ID,
              redisAvailable: true,
              durablyRecorded: true,
              locallyAborted: true,
              pausedCancelled: false,
              reason: 'recorded',
            },
          },
        ]
      ),
    }
  ),
  defineOpenApiRoute(
    v2ListWorkflowFoldersContract,
    workflowOperation({
      applicationOperation: workflowOperations.listFolders,
      operationId: 'listWorkflowsFolders',
      summary: 'List Workflow Folders',
      description: `List canonical workflow folders in a workspace. ${FULL_SET_LIST} ${FOLDER_TREE_TOO_LARGE}`,
      errors: [...WORKSPACE_ERRORS, 'NotFound', 'PayloadTooLarge'],
      success: jsonSuccess('A list of workflow folders.'),
    }),
    {
      query: documentedSchema(
        v2ListWorkflowFoldersContract.query,
        'ListWorkflowFoldersQuery',
        'List workflow folders query',
        'Workspace, parent path, search, and sorting filters.'
      ),
      response: documentedSchema(
        v2ListWorkflowFoldersContract.response.schema,
        'WorkflowFolderListResponse',
        'Workflow folder list response',
        'A list of canonical workflow folders.',
        [{ data: [WORKFLOW_FOLDER_EXAMPLE], nextCursor: null }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2CreateWorkflowFolderContract,
    workflowOperation({
      applicationOperation: workflowOperations.createFolder,
      operationId: 'createWorkflowsFolder',
      summary: 'Create Workflow Folder',
      description: `Create a canonical workflow folder in a workspace. ${FOLDER_TREE_TOO_LARGE}`,
      errors: [...RESOURCE_MUTATION_ERRORS, 'PayloadTooLarge'],
      success: jsonSuccess('The created workflow folder.'),
    }),
    {
      query: v2CreateWorkflowFolderContract.query,
      body: documentedSchema(
        v2CreateWorkflowFolderContract.body,
        'CreateWorkflowFolderRequest',
        'Create workflow folder request',
        'Workspace and canonical path for a new workflow folder.',
        [{ workspaceId: WORKSPACE_ID, path: '/Operations' }]
      ),
      response: documentedSchema(
        v2CreateWorkflowFolderContract.response.schema,
        'CreateWorkflowFolderResponse',
        'Create workflow folder response',
        'The created workflow folder.',
        [{ data: WORKFLOW_FOLDER_EXAMPLE }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2RelocateWorkflowFolderContract,
    workflowOperation({
      applicationOperation: workflowOperations.relocateFolder,
      operationId: 'relocateWorkflowsFolder',
      summary: 'Rename or Move Workflow Folder',
      description: `Rename or move a workflow folder and its descendants to a canonical path. ${FOLDER_TREE_TOO_LARGE}`,
      errors: [...RESOURCE_MUTATION_ERRORS, 'PayloadTooLarge'],
      success: jsonSuccess('The relocated workflow folder.'),
    }),
    {
      query: v2RelocateWorkflowFolderContract.query,
      body: documentedSchema(
        v2RelocateWorkflowFolderContract.body,
        'RelocateWorkflowFolderRequest',
        'Relocate workflow folder request',
        'Current and destination paths for a workflow folder.',
        [
          {
            workspaceId: WORKSPACE_ID,
            path: '/Operations',
            destinationPath: '/Support',
          },
        ]
      ),
      response: documentedSchema(
        v2RelocateWorkflowFolderContract.response.schema,
        'RelocateWorkflowFolderResponse',
        'Relocate workflow folder response',
        'The relocated workflow folder.',
        [{ data: { ...WORKFLOW_FOLDER_EXAMPLE, name: 'Support', path: '/Support' } }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2DeleteWorkflowFolderContract,
    workflowOperation({
      applicationOperation: workflowOperations.deleteFolder,
      operationId: 'deleteWorkflowsFolder',
      summary: 'Delete Workflow Folder',
      description: 'Delete a workflow folder, optionally including its descendants and workflows.',
      errors: [...RESOURCE_MUTATION_ERRORS, 'PayloadTooLarge'],
      success: jsonSuccess('The workflow folder was deleted.'),
    }),
    {
      query: documentedSchema(
        v2DeleteWorkflowFolderContract.query,
        'DeleteWorkflowFolderQuery',
        'Delete workflow folder query',
        'Workspace, folder path, and recursive deletion option.',
        [{ workspaceId: WORKSPACE_ID, path: '/Operations', recursive: 'false' }]
      ),
      response: documentedSchema(
        v2DeleteWorkflowFolderContract.response.schema,
        'DeleteWorkflowFolderResponse',
        'Delete workflow folder response',
        'Confirmation and counts for the deleted folder.',
        [
          {
            data: {
              path: '/Operations',
              deleted: true,
              deletedItems: { folders: 1, workflows: 0 },
            },
          },
        ]
      ),
    }
  ),
] as const

const routes = declaredRoutes.map(withRequestBodyErrors)

export const workflowsOpenApiDocument = defineOpenApiDocument({
  output: 'apps/docs/openapi-v2-workflows.json',
  info: {
    title: 'Sim API v2 — Workflows',
    description:
      'Version 2 of the Sim REST API for workflow management, deployment versions, execution, run lifecycle, folders, and portable import and export.',
    version: '2.0.0',
    contact: {
      name: 'Sim Support',
      email: 'help@sim.ai',
      url: 'https://www.sim.ai',
    },
    license: {
      name: 'Apache 2.0',
      url: 'https://www.apache.org/licenses/LICENSE-2.0.html',
    },
  },
  servers: [{ url: 'https://www.sim.ai', description: 'Production' }],
  tags: [
    {
      name: 'Workflows',
      description:
        'Manage and execute workflow definitions, folders, deployment versions, and portable imports and exports.',
    },
    {
      name: 'Workflow Runs',
      description: 'Inspect, resume, and cancel workflow runs.',
    },
  ],
  security: V2_AUTH_SECURITY,
  securitySchemes: V2_AUTH_SECURITY_SCHEMES,
  headers: { ...V2_BINARY_DOWNLOAD_HEADERS, ...V2_COMMON_HEADERS },
  errorSchema: V2_ERROR_SCHEMA,
  errorResponses: ERROR_RESPONSES,
  routes,
})
