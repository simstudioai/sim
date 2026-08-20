import {
  documentedSchema,
  ERROR_RESPONSES,
  type ErrorResponseId,
  FOLDER_TREE_TOO_LARGE,
  FULL_SET_LIST,
  HEAD_MIRRORS_GET,
  RATE_LIMIT_HEADERS,
  RESOURCE_CONFLICT_ERRORS,
  RESOURCE_ERRORS,
  RESOURCE_MUTATION_ERRORS,
  RUN_RETENTION,
  V2_API_KEY_SECURITY,
  V2_API_KEY_SECURITY_SCHEMES,
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

const WORKSPACE_ID = 'a91c4b2e-6d3f-4e8a-b5c7-0d9e2f1a8c64'
const WORKFLOW_ID = '3b1f7c92-8d4e-4a6b-9c0d-5e2f8a714b36'
const RUN_ID = 'run_8f14e45f-ceea-467f-a'

const WORKFLOW_EXAMPLE = {
  id: WORKFLOW_ID,
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
      operationId: 'getWorkflowState',
      summary: 'Get Workflow State',
      description:
        'Get the editable draft graph of a workflow: blocks, edges, the loop and parallel containers derived from them, and variables. This is the pollable read — it records no audit event, and `HEAD` mirrors `GET`. The payload is **unsanitized**: it carries workspace-scoped `credentialId`, `knowledgeBaseId`, and `tableId` values verbatim, so it is not portable to another workspace. Use `GET /workflows/{id}/export` for a portable, sanitized copy — and note that export is not a read-modify-write source, because sanitizing it drops every credential binding. Unknown members are stripped, so what this returns is exactly the set of keys `PUT /workflows/{id}/state` accepts.',
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
      operationId: 'replaceWorkflowState',
      summary: 'Replace Workflow State',
      description:
        'Replace a workflow\u2019s editable draft graph wholesale. `loops` and `parallels` are accepted but ignored — both are recomputed from `blocks`. Omitting `variables` leaves the stored variables untouched.\n\nLast write wins: concurrent writers are serialized by a row lock, so each lands a complete self-consistent graph and the later one replaces the earlier entirely. There is no partially-written state and no conflict detection.\n\nThis does not change what the deployed endpoint serves. Deployments are immutable versioned snapshots, and no schedule or webhook registration is touched. The only visible consequence is that `needsRedeployment` becomes true; `POST /workflows/{id}/deploy` publishes the draft.',
      errors: RESOURCE_MUTATION_ERRORS,
      success: jsonSuccess('The draft graph was replaced.'),
    }),
    {
      params: v2ReplaceWorkflowStateContract.params,
      query: v2ReplaceWorkflowStateContract.query,
      body: v2ReplaceWorkflowStateContract.body,
      response: documentedSchema(
        v2ReplaceWorkflowStateContract.response.schema,
        'ReplaceWorkflowStateResponse',
        'Replace workflow state response',
        'Outcome of replacing a workflow draft graph.',
        [{ data: { id: WORKFLOW_ID, warnings: [], needsRedeployment: true } }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2ApplyWorkflowOperationsContract,
    workflowOperation({
      operationId: 'applyWorkflowOperations',
      summary: 'Apply Workflow Operations',
      description:
        'Apply a batch of semantic edits — add, edit, delete, and subflow membership changes — to a workflow graph, plus an optional set of block enable/disable changes.\n\nBest-effort per operation, atomic per write. The engine applies what it can to an in-memory graph and reports the rest in `skipped`, each with a machine-readable `type`; exactly one write of the fully-resolved graph then happens, so there is never a partially-applied graph. `deferred` is **not** a failure list: a forward-referencing edge is wired automatically once its target block exists, in this batch or a later one, so re-issuing a deferred edge is wrong.\n\nSet `atomic` to fail closed: any genuine skipped item then aborts before the write and answers `409` with `error.details.code: "OPERATIONS_NOT_APPLIED"` and the same `skipped` array, having persisted nothing.\n\nAs with `PUT /workflows/{id}/state`, this changes only the draft; deploy to publish it.',
      errors: RESOURCE_MUTATION_ERRORS,
      success: jsonSuccess('The batch was applied.'),
    }),
    {
      params: v2ApplyWorkflowOperationsContract.params,
      query: v2ApplyWorkflowOperationsContract.query,
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
              lint: { unresolvedReferences: [], notes: [] },
              warnings: [],
              needsRedeployment: true,
            },
          },
        ]
      ),
    }
  ),
  defineOpenApiRoute(
    v2ApplyWorkflowVariablesContract,
    workflowOperation({
      operationId: 'applyWorkflowVariables',
      summary: 'Update Workflow Variables',
      description:
        'Add, edit, and delete a workflow\u2019s variables. Operations are matched by variable `name` and applied in order; a batch that changes nothing answers `200` with `changed: false`. Values are coerced to the declared `type`, and a value that cannot be coerced is stored as supplied. Read the current set from `variables` on `GET /workflows/{id}`.',
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
      operationId: 'restoreWorkflow',
      summary: 'Restore Workflow',
      description: `Bring an archived workflow back, along with the schedules, webhooks, MCP tools, and chats that were archived with it. A workflow that is not archived answers \`409\`. A workflow whose folder was archived is restored to the workspace root. ${FOLDER_TREE_TOO_LARGE}`,
      errors: RESOURCE_MUTATION_ERRORS,
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
      operationId: 'moveWorkflows',
      summary: 'Move Workflows',
      description: `Relocate up to 100 workflows into one folder. Explicitly best-effort: each workflow moves in its own transaction, and one that is absent from the workspace, archived, or locked lands in \`failed\` while the rest still move. Duplicate ids are collapsed. ${FOLDER_TREE_TOO_LARGE}`,
      errors: RESOURCE_MUTATION_ERRORS,
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
      operationId: 'deleteWorkflowV2',
      summary: 'Delete Workflow',
      description:
        'Archive a workflow. Despite the verb, this is not an erasure: the workflow, and the schedules, webhooks, MCP tools, and chats attached to it, are stamped archived and stop running, and `POST /workflows/{id}/restore` brings all of them back. An archived workflow disappears from the default list and is reachable with `scope=archived`. The `deleted` field is retained for shipped clients; `archived` states what actually happened.',
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
      operationId: 'updateWorkflowVersionV2',
      summary: 'Update Workflow Version',
      description:
        'Relabel a deployment version. Merge-patch shaped: an omitted key is unchanged and `description: null` clears the release note. Metadata only — the pinned graph is immutable, and this never changes which version is live. Promote a version with `POST /workflows/{id}/versions/{version}/activate`.',
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
      operationId: 'revertWorkflowVersion',
      summary: 'Revert Workflow To Version',
      description: `Overwrite the editable draft with the graph pinned by a deployment version, discarding every unsaved edit. This is the most destructive operation in the deployment family and it does **not** change what is live — to move production, use \`activate\` or \`rollback\`, both of which leave the draft alone. Pass \`active\` as the version to discard draft edits and return to the live graph. ${WORKSPACE_API_KEY_DENIED}`,
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
      operationId: 'getWorkflowDeployment',
      summary: 'Get Workflow Deployment',
      description:
        'Read the current deployment state of a workflow: whether a version is live, when it went live, the most recent deployment attempt with its readiness and failure payload, and whether the editable draft has since diverged from the live version. This is the only operation that publishes `needsRedeployment`.',
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
        'Current deployment state, including draft-versus-live drift.',
        [
          {
            data: {
              id: WORKFLOW_ID,
              isDeployed: true,
              needsRedeployment: true,
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
      operationId: 'updateWorkflowPublicApi',
      summary: 'Update Workflow Public API Access',
      description: `Enable or disable unauthenticated public execution of the deployed workflow. While enabled, anyone holding the execution URL can run the workflow without an API key. An organization that forbids public sharing refuses this with \`403\` and \`PUBLIC_SHARING_NOT_ALLOWED\`. ${WORKSPACE_API_KEY_DENIED}`,
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
      operationId: 'rollbackWorkflow',
      summary: 'Rollback Workflow',
      description: `Asynchronously reactivate a previous deployment version, selecting the preceding active version when no version is supplied. ${WORKSPACE_API_KEY_DENIED}`,
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
      operationId: 'exportWorkflow',
      summary: 'Export Workflow',
      description: `Export a portable, secret-sanitized workflow. Workspace-scoped bindings must be selected again after import. Exporting records an audit event, so it is not a safe read. ${HEAD_MIRRORS_GET} ${FOLDER_TREE_TOO_LARGE}`,
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
    v2ExecuteWorkflowContract,
    workflowOperation({
      operationId: 'executeWorkflowV2',
      summary: 'Execute Workflow',
      description: `Execute a deployed workflow synchronously, asynchronously, or as Server-Sent Events. Public workflows permit anonymous synchronous and streaming execution; asynchronous execution requires an API key. A synchronous run that exceeds its execution timeout returns HTTP 200 with \`status: "failed"\` and \`error.code: "TIMEOUT"\` rather than an HTTP error, so branch on \`status\`. ${EXECUTE_OPTION_CONSTRAINTS}`,
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
      security: [...V2_API_KEY_SECURITY, {}],
      success: {
        byStatus: {
          200: {
            description: 'A synchronous run result or Server-Sent Event stream.',
            headers: ['X-Run-Id', ...RATE_LIMIT_HEADERS],
            additionalContentTypes: ['text/event-stream'],
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
      operationId: 'getWorkflowRunV2',
      summary: 'Get Workflow Run',
      description: 'Get current workflow run state, optionally including final and block outputs.',
      errors: RESOURCE_CONFLICT_ERRORS,
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
            },
          },
        ]
      ),
    }
  ),
  defineOpenApiRoute(
    v2ResumeWorkflowContract,
    workflowRunOperation({
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
  security: V2_API_KEY_SECURITY,
  securitySchemes: V2_API_KEY_SECURITY_SCHEMES,
  headers: V2_COMMON_HEADERS,
  errorSchema: V2_ERROR_SCHEMA,
  errorResponses: ERROR_RESPONSES,
  routes,
})
