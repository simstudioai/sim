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
import { workspaceSyncOpenApiRoutes } from '@/lib/api/contracts/v2/openapi/workspace-sync'
import {
  EXECUTE_OPTION_CONSTRAINTS,
  v2ActivateWorkflowVersionContract,
  v2ApplyWorkflowOperationsContract,
  v2ApplyWorkflowVariablesContract,
  v2CancelWorkflowRunContract,
  v2CompareWorkflowVersionsContract,
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
  tableFieldIssues: [],
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
    blockOutputs: null,
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
      summary: 'List workflows',
      description: 'List active workflows in a workspace. Requires workspace read access.',
      descriptionDetails: `Use \`scope=archived\` to find workflows available for restoration. Filter by folder, deployment, or name; sort and page with the returned cursor. ${FOLDER_TREE_TOO_LARGE}`,
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
      summary: 'Create workflow',
      description:
        'Create an undeployed workflow at the workspace root or in a workflow folder. Requires workspace write access.',
      descriptionDetails: `The response includes the seeded start block and its ID for connecting other blocks. A name already used in the destination folder returns \`409\`. ${FOLDER_TREE_TOO_LARGE}`,
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
      summary: 'Get workflow state',
      description:
        'Read the saved editable draft, including blocks, edges, loop and parallel containers, and variables. Requires workspace read access. Configured values are included; use this state with Replace workflow state for same-workspace editing, or Export workflow for portable data with registered credential fields cleared. This read records no audit event; `HEAD` mirrors `GET`.',
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
      summary: 'Replace workflow state',
      description: `Replace the draft graph in one write. Requires workspace write access. Concurrent row-locked writes are last-write-wins; IDs owned by another workflow return \`409\`. Deployments, schedules, and webhook registrations are unchanged. Deploy to serve the edits.\n\nLint is advisory. Use \`dryRun=true\` to validate without saving, auditing, or notifying collaborators. ${WORKSPACE_API_KEY_DENIED}`,
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
      summary: 'Apply workflow operations',
      description: `Apply draft edits and block enablement changes in one write. Requires workspace write access. The live deployment is unchanged; lint is advisory.\n\nInspect \`skipped\` and \`inputValidationErrors\` for edits that did not apply. Deferred edges apply when their targets exist; do not resubmit them. With \`atomic=true\`, declined operations or dropped inputs return \`409\` (\`OPERATIONS_NOT_APPLIED\`) without saving. Use returned \`mintedBlockIds\` in later requests. \`dryRun=true\` evaluates without saving, auditing, or notifying. ${WORKSPACE_API_KEY_DENIED}`,
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
              mintedBlockIds: { 'agent-1': 'a3f1c0b2-7a44-4c1d-9d3a-2b8e5f0a1c77' },
              lint: {
                sources: [],
                sinks: [],
                orphanBlocks: [],
                emptyOutgoingPorts: [],
                invalidBranchPorts: [],
                invalidConnectionTargets: [],
                fieldIssues: [
                  {
                    blockId: 'a3f1c0b2-7a44-4c1d-9d3a-2b8e5f0a1c77',
                    blockName: 'Triage',
                    blockType: 'agent',
                    missingRequiredFields: ['systemPrompt'],
                    inactiveModeValues: [],
                  },
                ],
                unresolvedReferences: [],
                tableFieldIssues: [],
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
      summary: 'Update workflow variables',
      description:
        'Add, edit, or delete variables by name with workspace write access. Operations run in order. Values are coerced to their declared type when possible and otherwise stored as supplied. A no-op batch returns `changed: false`; read current values with Get workflow.',
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
      summary: 'Duplicate workflow',
      description: `Create an undeployed copy of a workflow's graph and variables in the same workspace. Requires workspace write access. The destination folder and name default to the source; name collisions in the destination are resolved automatically. ${FOLDER_TREE_TOO_LARGE}`,
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
      summary: 'Restore workflow',
      description: `Restore an archived workflow and its archived schedules, webhooks, MCP tools, and hosted chat. Requires workspace write access. An active workflow returns \`409\`. If its folder is archived, the workflow returns to the workspace root. ${FOLDER_TREE_TOO_LARGE}`,
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
      summary: 'Move workflows',
      description: `Move up to 100 workflows to one folder with workspace write access. Each move succeeds or fails independently; missing, archived, or locked workflows appear in \`failed\`. Duplicate IDs are ignored. ${FOLDER_TREE_TOO_LARGE}`,
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
      summary: 'Get workflow',
      description: `Get workflow metadata, variables, and trigger input fields from the saved draft. Requires workspace read access. Input fields may differ from the live deployment. ${FOLDER_TREE_TOO_LARGE}`,
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
      summary: 'Update workflow',
      description: `Update a workflow's name, description, or folder path with workspace write access. Omitted fields remain unchanged; \`description: null\` clears the description. ${FOLDER_TREE_TOO_LARGE}`,
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
      summary: 'Delete workflow',
      description:
        'Archive a workflow and stop its schedules, webhooks, MCP tools, and hosted chat. Requires workspace write access. Find it with List workflows (`scope=archived`) and recover it with Restore workflow. Both `deleted` and `archived` acknowledge archival.',
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
      summary: 'List workflow versions',
      description:
        'List saved deployment versions, newest first, with workspace read access. Each version pins an immutable graph; its name and release note can be updated.',
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
    v2CompareWorkflowVersionsContract,
    workflowOperation({
      applicationOperation: workflowOperations.compareVersions,
      operationId: 'compareWorkflowVersionsV2',
      summary: 'Compare workflow versions',
      description:
        'Compare two deployment versions of the same workflow with workspace read access. The comparison excludes layout changes and withholds credential-bearing values while reporting their changes. Connections include stable block and port IDs. The combined snapshots and the comparison result must each fit within 16 MiB.',
      errors: [...RESOURCE_ERRORS, 'PayloadTooLarge'],
      success: jsonSuccess('Changes from the base deployment to the target deployment.'),
    }),
    {
      params: v2CompareWorkflowVersionsContract.params,
      query: v2CompareWorkflowVersionsContract.query,
      response: documentedSchema(
        v2CompareWorkflowVersionsContract.response.schema,
        'WorkflowVersionComparisonResponse',
        'Workflow version comparison response',
        'Changes from base to target, with credential values withheld.',
        [
          {
            data: {
              workflowId: WORKFLOW_ID,
              base: 1,
              target: 2,
              diff: {
                addedBlocks: [],
                removedBlocks: [],
                modifiedBlocks: [],
                edgeChanges: { added: 0, removed: 0, addedDetails: [], removedDetails: [] },
                loopChanges: { added: 0, removed: 0, modified: 0 },
                parallelChanges: { added: 0, removed: 0, modified: 0 },
                containerChanges: [],
                variableChanges: {
                  added: 0,
                  removed: 0,
                  modified: 0,
                  addedNames: [],
                  removedNames: [],
                  modifiedNames: [],
                },
                hasChanges: false,
              },
            },
          },
        ]
      ),
    }
  ),
  defineOpenApiRoute(
    v2GetWorkflowVersionContract,
    workflowOperation({
      applicationOperation: workflowOperations.readVersion,
      operationId: 'getWorkflowVersionV2',
      summary: 'Get workflow version',
      description:
        'Get a deployment version and its pinned graph with workspace read access. Registered credential fields and opaque table/tool values are cleared. Environment references and ordinary workflow variables remain included; review other configuration before sharing.',
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
      summary: 'Update workflow version',
      description:
        "Update a deployment version's name or release note with workspace write access. Omitted fields remain unchanged; `description: null` clears the note. The graph and live version are unchanged. Use Activate workflow version to serve it.",
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
      summary: 'Activate workflow version',
      description: `Activate a specific deployment version asynchronously. Requires workspace Admin access and works when the workflow is undeployed. The draft is unchanged. Poll Get workflow deployment for the accepted \`latestDeploymentAttempt\`; \`isDeployed\` alone can describe an older live version. ${WORKSPACE_API_KEY_DENIED}`,
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
      summary: 'Revert workflow to version',
      description: `Overwrite the editable draft with a deployment version, discarding current draft edits. Requires workspace Admin access. Use \`active\` for the live version. The live deployment is unchanged; use Activate workflow version or Rollback workflow to change it. ${WORKSPACE_API_KEY_DENIED}`,
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
      summary: 'Get workflow deployment',
      description: `Read live deployment status, the latest attempt's readiness or failure, and draft divergence (\`needsRedeployment\`). Requires workspace read access. \`isPublicApi\` reports anonymous billed execution; \`webhooks\` lists registered delivery URLs.\n\n${WORKFLOW_DEPLOYMENT_VS_CHAT}`,
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
              webhooks: [
                {
                  blockId: 'blk_01J8ZK3QW4M6X2R9T7B5C0V3',
                  provider: 'generic',
                  url: 'https://www.sim.ai/api/webhooks/trigger/leads',
                },
              ],
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
      summary: 'Update workflow public API access',
      description: `Enable or disable unauthenticated execution of the deployed workflow. Requires workspace Admin access. Enabling lets anyone with the execution URL consume billed usage. Organization sharing restrictions return \`403\` with \`PUBLIC_SHARING_NOT_ALLOWED\`. Hosted chat is managed separately. ${WORKSPACE_API_KEY_DENIED}`,
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
      summary: 'Deploy workflow',
      description: `Create a deployment version and activate it asynchronously. Requires workspace Admin access. Each accepted deploy creates a new version; retrying after a timeout can create a duplicate. Poll Get workflow deployment for the accepted \`latestDeploymentAttempt\` before treating the version as live.\n\n\`lint\` reports advisory findings for this version and never blocks deployment. A conflicting webhook path returns \`409\`. ${WORKSPACE_API_KEY_DENIED}`,
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
              lint: EMPTY_LINT_EXAMPLE,
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
      summary: 'Undeploy workflow',
      description: `Deactivate the live workflow version and stop its scheduled and webhook triggers. Requires workspace Admin access and a deployed workflow. Deployed MCP tools become inactive; \`archivedMcpTools\` identifies them. ${WORKSPACE_API_KEY_DENIED}`,
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
              archivedMcpTools: [],
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
      summary: 'Rollback workflow',
      description: `Activate a previous deployment version asynchronously, defaulting to the preceding active version. Requires workspace Admin access and a deployed workflow. The draft is unchanged. Poll the accepted \`latestDeploymentAttempt\`. To select a version while undeployed, use Activate workflow version. ${WORKSPACE_API_KEY_DENIED}`,
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
      summary: 'Export workflow',
      description: `Export the saved draft as portable workflow data with workspace read access. Registered credential fields and opaque table/tool values are cleared; environment references and ordinary workflow variables remain included. Review other configuration before sharing.\n\nDefault exports clear workspace bindings. Use \`includeWorkspaceBindings=true\` to retain non-secret bindings for a same-workspace import, or \`includeReferences=true\` for source identities and field occurrences used by mapped imports. Exporting records an audit event. ${HEAD_MIRRORS_GET} ${FOLDER_TREE_TOO_LARGE}`,
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
        'Portable workflow data with registered credential fields cleared.',
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
      summary: 'Import workflow',
      description: `Create an undeployed workflow from a portable export object, bare draft state, or JSON string. Requires workspace write access. The empty-state example creates a draft that needs runnable blocks before execution.\n\nMapped imports require a preview with the same choices, its \`previewFingerprint\`, and a stable \`requestId\`. Unresolved required configuration creates nothing. Identical retries return the committed result; reusing the ID with changed inputs returns \`409\`. The result includes regenerated graph IDs and an operation receipt. ${FOLDER_TREE_TOO_LARGE}`,
      errors: [...RESOURCE_MUTATION_ERRORS, 'PayloadTooLarge'],
      success: jsonSuccess('The imported workflow.'),
    }),
    {
      query: v2ImportWorkflowContract.query,
      body: documentedSchema(
        v2ImportWorkflowContract.body,
        'ImportWorkflowBody',
        'Import workflow input',
        'Workflow document, destination, and optional reviewed mappings. This example creates an empty draft.',
        [{ workspaceId: WORKSPACE_ID, name: 'Support draft', workflow: { blocks: {}, edges: [] } }]
      ),
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
              blocks: [
                { id: 'block_start', type: 'starter', name: 'Start' },
                { id: 'block_triage', type: 'agent', name: 'Triage' },
                { id: 'block_reply', type: 'response', name: 'Reply' },
              ],
              warnings: ['Triage: knowledgeBaseId was stripped by export; set it before running'],
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
      summary: 'List chat deployments',
      description:
        "List hosted chats and their URLs with workspace read access and cursor pagination. Filter by `workflowId` for one workflow's chat. The admin-only detail read also includes visitor access settings and customizations. Passwords are never returned; organization permission groups can restrict chat deployment access.",
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
      summary: 'Get workflow chat deployment',
      description: `Get a workflow's hosted chat and visitor access settings with workspace Admin access. A missing chat returns \`404\`. Passwords are never returned; \`hasPassword\` reports whether one is set. Hosted chat and workflow API deployment are managed separately. ${WORKSPACE_API_KEY_DENIED}`,
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
      summary: 'Create or replace workflow chat deployment',
      description: `Create or replace a workflow's hosted chat and deploy its saved draft. Requires workspace Admin access. Omitted fields use defaults; customization exceptions are described on their fields.\n\nPassword authentication requires \`password\`; email or SSO requires non-empty \`allowedEmails\`. Public authentication lets anyone with the chat URL run it. A duplicate identifier or pending deployment returns \`409\`. ${WORKSPACE_API_KEY_DENIED}`,
      errors: [...RESOURCE_ERRORS, 'Conflict', 'PayloadTooLarge', 'Locked'],
      success: jsonSuccess('The saved chat deployment.'),
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
      summary: 'Delete workflow chat deployment',
      description: `Remove the hosted chat and release its URL identifier with workspace Admin access. The workflow API deployment remains active; use Undeploy workflow to stop it. ${WORKSPACE_API_KEY_DENIED}`,
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
      summary: 'Execute workflow',
      description: `Run the active deployment, or set \`run.source: "manual"\` to run the saved draft. Deployed execution requires workspace read access and OAuth \`api:write\` scope or an API key; public deployments also allow anonymous synchronous or streamed runs. Manual runs require personal-key or OAuth write access and cannot be async.\n\nUse \`async: true\` for a queue receipt, or \`stream: true\` for SSE. For a synchronous run with both flags false, send \`Accept: application/x-ndjson\` for heartbeat frames and a final frame containing \`data\`. Timeouts return \`200\` with \`status: "failed"\` and \`error.code: "TIMEOUT"\`; inspect run status. See [Streaming](/workflows/deployment/api#streaming) for event formats. ${EXECUTE_OPTION_CONSTRAINTS}\n\nSupply \`X-Run-Id\` to prevent duplicate execution. Reuse returns \`409\`, without replaying results. A \`503\` with \`error.details.code: "ASYNC_ENQUEUE_AMBIGUOUS"\` omits \`Retry-After\` because the run may already have started. Reconcile using the returned run ID; do not start another run with a new or omitted ID.`,
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
      summary: 'List workflow runs',
      description: `List recorded workflow runs with workspace read access, filters, and cursor pagination. Cost can be hidden by organization permission groups. ${RUN_RETENTION}`,
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
      summary: 'Get workflow run',
      description: `Read current run state with workspace read access. Request final output and files with \`includeOutput\`, or block outputs with \`selectedOutputs\`. Organization permission groups can hide output, files, or cost.\n\n\`includeFileBase64\` inlines file bytes. A file or the total above 16 MiB returns \`413\` naming a download path; download large files individually. ${HEAD_MIRRORS_GET}`,
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
      summary: 'Download workflow run file',
      description: `Download one run-produced file by its reported ID with workspace read access. Downloads record an audit event. ${RUN_RETENTION} ${HEAD_MIRRORS_GET} \`HEAD\` does not provide byte length; use the file's size in Get workflow run when available.`,
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
      summary: 'Resume workflow run',
      description:
        'Resume one human-in-the-loop pause with workspace write access. The resumed attempt receives a new run ID and returns a synchronous result or queue receipt. A run that originally streamed resumes asynchronously through v2; this endpoint returns no SSE stream.',
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
      summary: 'Cancel workflow run',
      description:
        'Request cancellation of a running, queued, or paused workflow run with workspace write access. Cancellation is best effort; inspect the outcome flags and `reason`. A terminal run returns `200` with `success: false` and an `already_*` reason. A table workflow-group run returns `409` when its cell can no longer accept cancellation.',
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
      summary: 'List workflow folders',
      description: `List workflow folders with workspace read access, optional parent/name filters, and sorting. ${FULL_SET_LIST} ${FOLDER_TREE_TOO_LARGE}`,
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
      summary: 'Create workflow folder',
      description: `Create a workflow folder at a non-root path with workspace write access. ${FOLDER_TREE_TOO_LARGE}`,
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
      summary: 'Rename or move workflow folder',
      description: `Rename or move a workflow folder and update descendant paths with workspace write access. An existing destination receives the folder as a child; otherwise the destination is its new full path. ${FOLDER_TREE_TOO_LARGE}`,
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
      summary: 'Delete workflow folder',
      description:
        "Archive an empty workflow folder with workspace write access. `recursive=true` also archives its subfolders and workflows, stopping the archived workflows' triggers and hosted surfaces. Use Restore workflow to recover workflows.",
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
      name: 'Workspace Sync',
      description:
        'Portable workflow configuration, workspace forks, push and pull, and durable operation status.',
    },
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
  routes: [...routes, ...workspaceSyncOpenApiRoutes],
})
