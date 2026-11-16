import {
  documentedSchema,
  RATE_LIMIT_HEADERS,
  RESOURCE_ERRORS,
} from '@/lib/api/contracts/v2/openapi/shared'
import { v2GetWorkflowSourceContract } from '@/lib/api/contracts/v2/workflow-source'
import { defineOpenApiRoute } from '@/lib/api/openapi/types'
import { workflowOperations } from '@/lib/workflows/application/operations'

const BLOCK_ID = '5b0c2f7e-91d4-4a63-8e2b-0f6d3c9a1e47'
const FINGERPRINT = 'sf1:9c1d4e7f0a3b6c9d2e5f8a1b4c7d0e3f6a9b2c5d8e1f4a7b0c3d6e9f2a5b8c1d'
const CATALOG_HASH = '3f0c1a9e5b7d2c4f6a8e0b1d3c5f7a9e2b4d6f8a0c2e4b6d8f0a2c4e6b8d0f2a'

const WORKFLOW_SOURCE_EXAMPLE = {
  workflowId: '3a9e21d8-5f47-4c0b-b2ea-91d7c6034ef8',
  workspaceId: '7e2d9c14-6b83-4a55-8f01-c4d3e9a76b28',
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
    workspaceId: '7e2d9c14-6b83-4a55-8f01-c4d3e9a76b28',
    baseFingerprint: FINGERPRINT,
    catalogHash: CATALOG_HASH,
  },
  fingerprint: FINGERPRINT,
  canonicalHash: '0d6e2b8a4c1f7e3d9b5a2c8f4e1d7b3a9c6f2e8d4b1a7c3e9f5d2b8a4c1e7f3d',
  catalogVersion: CATALOG_HASH,
  sdkMajor: 1,
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
]
