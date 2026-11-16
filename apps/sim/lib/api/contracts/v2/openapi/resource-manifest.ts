import {
  documentedSchema,
  RATE_LIMIT_HEADERS,
  RESOURCE_ERRORS,
} from '@/lib/api/contracts/v2/openapi/shared'
import { v2GetResourceManifestContract } from '@/lib/api/contracts/v2/resource-manifest'
import { defineOpenApiRoute } from '@/lib/api/openapi/types'
import { workflowCodeOperations } from '@/lib/workflows/code/operations'

const RESOURCE_MANIFEST_EXAMPLE = {
  workspaceId: '7e2d9c14-6b83-4a55-8f01-c4d3e9a76b28',
  tables: [
    {
      key: 'tickets',
      id: 'tbl_4f1c2a9e',
      name: 'Tickets',
      columns: [
        { name: 'subject', type: 'string' },
        { name: 'status', type: 'select', options: ['open', 'closed'] },
      ],
    },
  ],
  knowledgeBases: [{ key: 'docs', id: 'kb_93a1e7c2', name: 'Docs' }],
  bindings: [
    { key: 'support-slack', id: 'cred_51d0b8f4', name: 'Support Slack', service: 'slack' },
  ],
  workflows: [
    {
      key: 'assign-owner',
      id: '3a9e21d8-5f47-4c0b-b2ea-91d7c6034ef8',
      name: 'Assign owner',
      inputs: [{ name: 'leads', type: 'array' }],
    },
  ],
  env: ['CRM_KEY'],
  truncated: false,
}

export const resourceManifestOpenApiRoutes = [
  defineOpenApiRoute(
    v2GetResourceManifestContract,
    {
      applicationOperation: workflowCodeOperations.readResourceManifest,
      operationId: 'getResourceManifest',
      summary: 'Get resource manifest',
      description:
        'List the workspace resources workflow source can name, each with the key source uses for it: tables with their columns, knowledge bases, saved credentials with their provider, workflows with their start-block inputs, and the names (never values) of the environment variables a run can read. A resource keeps its key when renamed; one that no source has named yet is given its key by this call. Each kind lists its oldest 1000 resources, and `truncated` says when there were more. Returns `403` while code-first workflows are not enabled.',
      tags: ['Workflows'],
      errors: RESOURCE_ERRORS,
      success: { description: 'The resource manifest.', headers: RATE_LIMIT_HEADERS },
    },
    {
      query: v2GetResourceManifestContract.query,
      params: documentedSchema(
        v2GetResourceManifestContract.params,
        'GetResourceManifestParams',
        'Get resource manifest path parameters',
        'Workspace whose resources to list.'
      ),
      response: documentedSchema(
        v2GetResourceManifestContract.response.schema,
        'GetResourceManifestResponse',
        'Get resource manifest response',
        'The workspace resources workflow source can name.',
        [{ data: RESOURCE_MANIFEST_EXAMPLE }]
      ),
    }
  ),
]
