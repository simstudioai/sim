import { SOURCE_LIMITS } from '@sim/workflow-code/limits'
import {
  documentedSchema,
  RATE_LIMIT_HEADERS,
  RESOURCE_ERRORS,
  RESOURCE_MUTATION_ERRORS,
  WORKSPACE_API_KEY_DENIED,
} from '@/lib/api/contracts/v2/openapi/shared'
import {
  v2ApplyWorkflowSourceContract,
  v2CreateWorkflowFromSourceContract,
  v2GetWorkflowSourceContract,
  v2PlanWorkflowSourceContract,
} from '@/lib/api/contracts/v2/workflow-source'
import { defineOpenApiRoute } from '@/lib/api/openapi/types'
import { workflowOperations } from '@/lib/workflows/application/operations'

const BLOCK_ID = 'a3f1c0b2-7a44-4c1d-9d3a-2b8e5f0a1c77'
const FINGERPRINT = 'sf1:9c1d4e7f0a3b6c9d2e5f8a1b4c7d0e3f6a9b2c5d8e1f4a7b0c3d6e9f2a5b8c1d'
const CATALOG_HASH = '3f0c1a9e5b7d2c4f6a8e0b1d3c5f7a9e2b4d6f8a0c2e4b6d8f0a2c4e6b8d0f2a'

const WORKFLOW_SOURCE_EXAMPLE = {
  workflowId: '3b1f7c92-8d4e-4a6b-9c0d-5e2f8a714b36',
  workspaceId: 'a91c4b2e-6d3f-4e8a-b5c7-0d9e2f1a8c64',
  files: {
    'workflow.ts':
      "// @sim-sdk 1\nimport { trigger, workflow } from '@sim/workflow-sdk'\n\nexport default workflow('Support triage', () => {\n  const start = trigger.start('Start')\n})\n",
  },
  lock: {
    version: 1,
    blocks: { start: { id: BLOCK_ID, parent: null, ident: 'start', order: 0 } },
    variables: {},
  },
  base: {
    version: 1,
    workflowId: '3b1f7c92-8d4e-4a6b-9c0d-5e2f8a714b36',
    workspaceId: 'a91c4b2e-6d3f-4e8a-b5c7-0d9e2f1a8c64',
    fingerprint: FINGERPRINT,
    catalogHash: CATALOG_HASH,
  },
  canonicalHash: '0d6e2b8a4c1f7e3d9b5a2c8f4e1d7b3a9c6f2e8d4b1a7c3e9f5d2b8a4c1e7f3d',
  sdkMajor: 1,
  blockTypes: ['start_trigger'],
  diagnostics: [],
}

export const workflowSourceOpenApiRoutes = [
  defineOpenApiRoute(
    v2GetWorkflowSourceContract,
    {
      applicationOperation: workflowOperations.readSource,
      operationId: 'getWorkflowSource',
      summary: 'Get workflow source',
      description: `Read the saved draft as TypeScript source written against the workflow SDK, with its identity lock and its \`base\`. The lock binds each block key in the source to its stored id; \`base\` records the workflow, workspace, freshness fingerprint and block catalog the source was read at. The fingerprint ignores canvas positions, so moving blocks does not change it. Workspace resources such as tables and knowledge bases appear by their resource key: allocated from the resource's name the first time source names it, then never changed, so renaming the resource keeps its key. An id that matches no resource in the workspace prints as an unresolved reference. Function-block code goes to \`functions/*\` files unless \`functionCode\` is \`inline\`. A workflow too large to apply back as source (more than ${SOURCE_LIMITS.maxBlocks} blocks or ${SOURCE_LIMITS.maxVariables} variables, over ${SOURCE_LIMITS.maxTotalBytes} bytes of files in all, or nested deeper than ${SOURCE_LIMITS.maxDepth} levels) returns \`413\` naming the measured size. This read records no audit event. \`HEAD\` checks access as \`GET\` does and answers with no body, without reading the draft, so it never reports a too-large workflow. Returns \`403\` while workflows as code is not enabled.`,
      tags: ['Workflows'],
      errors: [...RESOURCE_ERRORS, 'PayloadTooLarge'],
      success: { description: 'The workflow draft as source.', headers: RATE_LIMIT_HEADERS },
    },
    {
      params: v2GetWorkflowSourceContract.params,
      query: documentedSchema(
        v2GetWorkflowSourceContract.query,
        'GetWorkflowSourceQuery',
        'Get workflow source query',
        'How the source is printed.'
      ),
      response: documentedSchema(
        v2GetWorkflowSourceContract.response.schema,
        'GetWorkflowSourceResponse',
        'Get workflow source response',
        'The workflow draft as TypeScript source.',
        [{ data: WORKFLOW_SOURCE_EXAMPLE }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2ApplyWorkflowSourceContract,
    {
      applicationOperation: workflowOperations.applySource,
      operationId: 'applyWorkflowSource',
      summary: 'Apply workflow source',
      description: `Write TypeScript workflow source to the saved draft in one all-or-nothing write. Send the files, lock and \`base\` from Get Workflow Source with your edits. Requires workspace write access. The live deployment is unchanged.\n\nThe server compiles the files and checks them against the same rules as canvas and operation edits. Any error returns \`400\` with \`details.code\` \`SOURCE_REJECTED\` and \`details.diagnostics\` (each with a file, line and column), and nothing is saved; a source over a size limit (\`E_LIMIT_EXCEEDED\`) gets the same body with \`413\`. A \`409\` means the draft changed since the source was read (\`details.currentFingerprint\`): get the source again, reapply the edit and retry. A rename onto a name another workflow in the folder took meanwhile returns \`409\` with \`details.code\` \`SOURCE_NAME_TAKEN\`. A \`base.workflowId\` that names another workflow is refused with \`400\` (\`E_APPLY_WORKFLOW_MISMATCH\`). Locked blocks cannot be changed from source. Unchanged blocks keep their ids and stored values, renamed blocks keep their ids, and existing blocks keep their canvas positions. Source that matches the draft returns \`applied: false\` without saving. The response re-prints the saved source with its new lock and \`base\`. \`dryRun=true\` runs every check without saving and answers \`200\` with the findings in \`diagnostics\`, a stale \`base\` included (\`E_APPLY_STALE\`). A request refused before the source is evaluated is refused on a dry run too: \`400\` for an invalid body, \`413\` for a body over the size limit, and \`423\` for a locked workflow or folder. Returns \`403\` while workflows as code is not enabled. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Workflows'],
      errors: [...RESOURCE_MUTATION_ERRORS, 'PayloadTooLarge'],
      success: { description: 'The applied (or evaluated) source.', headers: RATE_LIMIT_HEADERS },
    },
    {
      params: v2ApplyWorkflowSourceContract.params,
      query: documentedSchema(
        v2ApplyWorkflowSourceContract.query,
        'ApplyWorkflowSourceQuery',
        'Apply workflow source query',
        'Whether to evaluate without saving.'
      ),
      body: documentedSchema(
        v2ApplyWorkflowSourceContract.body,
        'ApplyWorkflowSourceBody',
        'Apply workflow source body',
        'Edited source files with the lock and base they were read with.',
        [
          {
            files: WORKFLOW_SOURCE_EXAMPLE.files,
            lock: WORKFLOW_SOURCE_EXAMPLE.lock,
            base: WORKFLOW_SOURCE_EXAMPLE.base,
          },
        ]
      ),
      response: documentedSchema(
        v2ApplyWorkflowSourceContract.response.schema,
        'ApplyWorkflowSourceResponse',
        'Apply workflow source response',
        'The outcome, with the source re-printed from the saved draft.',
        [
          {
            data: {
              workflowId: WORKFLOW_SOURCE_EXAMPLE.workflowId,
              workspaceId: WORKFLOW_SOURCE_EXAMPLE.workspaceId,
              dryRun: false,
              applied: false,
              diff: {
                noop: true,
                blocks: { added: [], removed: [], renamed: [], modified: [] },
                edges: { added: 0, removed: 0 },
                variables: { added: [], removed: [], renamed: [], modified: [] },
              },
              diagnostics: [],
              files: WORKFLOW_SOURCE_EXAMPLE.files,
              lock: WORKFLOW_SOURCE_EXAMPLE.lock,
              base: WORKFLOW_SOURCE_EXAMPLE.base,
              mintedIds: {},
              notes: [],
              needsRedeployment: false,
            },
          },
        ]
      ),
    }
  ),
  defineOpenApiRoute(
    v2PlanWorkflowSourceContract,
    {
      applicationOperation: workflowOperations.planSource,
      operationId: 'planWorkflowSource',
      summary: 'Plan workflow source',
      description: `Report what Apply Workflow Source would do with this source, without writing: whether the draft changed since \`base\` (\`E_APPLY_STALE\`), the diff, and every finding, exactly as \`dryRun=true\` reports them, with \`200\`. A read: it needs only workspace read access, draws on the source-plan budget rather than the source-write budget (a server already running as many plans as it allows answers \`429\`), and records no audit or analytics event, so \`sim workflows source status\` never spends what an apply needs. \`allowDelete=true\` plans block and variable deletes instead of reporting \`E_APPLY_BLOCK_DELETE\` or \`E_APPLY_VARIABLE_DELETE\`. Returns \`403\` while workflows as code is not enabled. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Workflows'],
      errors: [...RESOURCE_ERRORS, 'PayloadTooLarge'],
      success: { description: 'The evaluated source.', headers: RATE_LIMIT_HEADERS },
    },
    {
      params: v2PlanWorkflowSourceContract.params,
      query: documentedSchema(
        v2PlanWorkflowSourceContract.query,
        'PlanWorkflowSourceQuery',
        'Plan workflow source query',
        'Whether to plan block and variable deletes.'
      ),
      body: documentedSchema(
        v2PlanWorkflowSourceContract.body,
        'PlanWorkflowSourceBody',
        'Plan workflow source body',
        'Edited source files with the lock and base they were read with.',
        [
          {
            files: WORKFLOW_SOURCE_EXAMPLE.files,
            lock: WORKFLOW_SOURCE_EXAMPLE.lock,
            base: WORKFLOW_SOURCE_EXAMPLE.base,
          },
        ]
      ),
      response: documentedSchema(
        v2PlanWorkflowSourceContract.response.schema,
        'PlanWorkflowSourceResponse',
        'Plan workflow source response',
        'What an apply would store, and every finding.',
        [
          {
            data: {
              workflowId: WORKFLOW_SOURCE_EXAMPLE.workflowId,
              workspaceId: WORKFLOW_SOURCE_EXAMPLE.workspaceId,
              dryRun: true,
              applied: false,
              diff: {
                noop: true,
                blocks: { added: [], removed: [], renamed: [], modified: [] },
                edges: { added: 0, removed: 0 },
                variables: { added: [], removed: [], renamed: [], modified: [] },
              },
              diagnostics: [],
              files: WORKFLOW_SOURCE_EXAMPLE.files,
              lock: WORKFLOW_SOURCE_EXAMPLE.lock,
              base: WORKFLOW_SOURCE_EXAMPLE.base,
              mintedIds: {},
              notes: [],
              needsRedeployment: false,
            },
          },
        ]
      ),
    }
  ),
  defineOpenApiRoute(
    v2CreateWorkflowFromSourceContract,
    {
      applicationOperation: workflowOperations.createFromSource,
      operationId: 'createWorkflowFromSource',
      summary: 'Create workflow from source',
      description: `Create a workflow from TypeScript workflow source in one all-or-nothing write. Requires workspace write access. The source is compiled and checked against the same rules as Apply Workflow Source; every block is new. Any error returns \`400\` with \`details.code\` \`SOURCE_REJECTED\` and \`details.diagnostics\` (each with a file, line and column), and nothing is created; a source over a size limit (\`E_LIMIT_EXCEEDED\`) gets the same body with \`413\`. The name defaults to the one in the source's \`workflow('…')\` call; a name already used in the folder returns \`409\` with \`details.code\` \`SOURCE_NAME_TAKEN\`. The response carries the new \`workflowId\` and the source re-printed from what was saved, with its lock and \`base\`, ready for the next apply. The workflow is not deployed. \`dryRun=true\` runs every check without creating anything and answers \`200\` with the findings in \`diagnostics\`. A request refused before the source is evaluated is refused on a dry run too: \`400\` for an invalid body, \`404\` for a missing folder, \`413\` for a body over the size limit, and \`423\` for a locked folder. A taken name is checked after the source compiles and answers \`409\` (\`SOURCE_NAME_TAKEN\`) on a dry run as on a create. Returns \`403\` while workflows as code is not enabled. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Workflows'],
      errors: [...RESOURCE_MUTATION_ERRORS, 'PayloadTooLarge'],
      success: { description: 'The created (or evaluated) workflow.', headers: RATE_LIMIT_HEADERS },
    },
    {
      params: documentedSchema(
        v2CreateWorkflowFromSourceContract.params,
        'CreateWorkflowFromSourceParams',
        'Create workflow from source path parameters',
        'Workspace in which to create the workflow.'
      ),
      query: documentedSchema(
        v2CreateWorkflowFromSourceContract.query,
        'CreateWorkflowFromSourceQuery',
        'Create workflow from source query',
        'Whether to evaluate without creating.'
      ),
      body: documentedSchema(
        v2CreateWorkflowFromSourceContract.body,
        'CreateWorkflowFromSourceBody',
        'Create workflow from source body',
        'Source files and where to create the workflow.',
        [{ files: WORKFLOW_SOURCE_EXAMPLE.files, folderPath: '/Operations' }]
      ),
      response: documentedSchema(
        v2CreateWorkflowFromSourceContract.response.schema,
        'CreateWorkflowFromSourceResponse',
        'Create workflow from source response',
        'The outcome, with the source re-printed from the saved workflow.',
        [
          {
            data: {
              workflowId: WORKFLOW_SOURCE_EXAMPLE.workflowId,
              workspaceId: WORKFLOW_SOURCE_EXAMPLE.workspaceId,
              dryRun: false,
              applied: true,
              diff: {
                noop: false,
                blocks: {
                  added: [{ id: BLOCK_ID, key: 'start', type: 'start_trigger' }],
                  removed: [],
                  renamed: [],
                  modified: [],
                },
                edges: { added: 0, removed: 0 },
                variables: { added: [], removed: [], renamed: [], modified: [] },
              },
              diagnostics: [],
              files: WORKFLOW_SOURCE_EXAMPLE.files,
              lock: WORKFLOW_SOURCE_EXAMPLE.lock,
              base: WORKFLOW_SOURCE_EXAMPLE.base,
              mintedIds: { start: BLOCK_ID },
              notes: [],
              needsRedeployment: false,
            },
          },
        ]
      ),
    }
  ),
]
