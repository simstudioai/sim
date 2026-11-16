import {
  documentedSchema,
  RATE_LIMIT_HEADERS,
  RESOURCE_ERRORS,
  RESOURCE_MUTATION_ERRORS,
  WORKSPACE_API_KEY_DENIED,
} from '@/lib/api/contracts/v2/openapi/shared'
import {
  v2ApplyWorkflowSourceContract,
  v2GetWorkflowSourceContract,
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
    lockVersion: 1,
    blocks: { start: { id: BLOCK_ID, parent: null, binding: 'start', order: 0 } },
    variables: {},
  },
  lockBase: {
    workspaceId: 'a91c4b2e-6d3f-4e8a-b5c7-0d9e2f1a8c64',
    baseFingerprint: FINGERPRINT,
    catalogHash: CATALOG_HASH,
  },
  fingerprint: FINGERPRINT,
  canonicalHash: '0d6e2b8a4c1f7e3d9b5a2c8f4e1d7b3a9c6f2e8d4b1a7c3e9f5d2b8a4c1e7f3d',
  catalogVersion: CATALOG_HASH,
  sdkMajor: 1,
  blockTypes: ['start_trigger'],
  warnings: [],
}

export const workflowSourceOpenApiRoutes = [
  defineOpenApiRoute(
    v2GetWorkflowSourceContract,
    {
      applicationOperation: workflowOperations.readSource,
      operationId: 'getWorkflowSource',
      summary: 'Get workflow source',
      description:
        'Read the saved draft as TypeScript source written against the workflow SDK, with its identity lock and a freshness `fingerprint`. The lock binds each block key in the source to its stored id; `lockBase` records the fingerprint and block catalog the source was read at. The fingerprint ignores canvas positions, so moving blocks does not change it. Workspace resources such as tables and knowledge bases appear as keys derived from their current names, so renaming a resource changes its key; an id that matches no resource in the workspace prints as an unresolved reference. Function-block code goes to `functions/*` files unless `functionCode` is `inline`. This read records no audit event; `HEAD` mirrors `GET`. Returns `403` while code-first workflows are not enabled.',
      tags: ['Workflows'],
      errors: RESOURCE_ERRORS,
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
      description: `Write TypeScript workflow source to the saved draft in one all-or-nothing write. Send the files, lock and \`fingerprint\` from Get Workflow Source with your edits. Requires workspace write access. The live deployment is unchanged.\n\nThe server compiles the files and checks them against the same rules as canvas and operation edits. Any error returns \`400\` with \`details.code\` \`SOURCE_REJECTED\` and \`details.diagnostics\` (each with a file, line and column), and nothing is saved. A \`409\` means the draft changed since the source was read (\`details.currentFingerprint\`): get the source again, reapply the edit and retry. Locked blocks cannot be changed from source. Unchanged blocks keep their ids and stored values, renamed blocks keep their ids, and existing blocks keep their canvas positions. Source that matches the draft returns \`applied: false\` without saving. The response re-prints the saved source with its new lock and fingerprint. \`dryRun=true\` runs every check without saving and always returns \`200\`. Returns \`403\` while code-first workflows are not enabled. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Workflows'],
      errors: RESOURCE_MUTATION_ERRORS,
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
        'Edited source files with the lock and fingerprint they were read with.',
        [
          {
            files: WORKFLOW_SOURCE_EXAMPLE.files,
            lock: WORKFLOW_SOURCE_EXAMPLE.lock,
            lockBase: WORKFLOW_SOURCE_EXAMPLE.lockBase,
            baseFingerprint: FINGERPRINT,
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
                variables: { added: [], removed: [], modified: [] },
              },
              diagnostics: [],
              newFingerprint: FINGERPRINT,
              files: WORKFLOW_SOURCE_EXAMPLE.files,
              lock: WORKFLOW_SOURCE_EXAMPLE.lock,
              lockBase: WORKFLOW_SOURCE_EXAMPLE.lockBase,
              mintedIds: {},
              warnings: [],
              needsRedeployment: false,
            },
          },
        ]
      ),
    }
  ),
]
