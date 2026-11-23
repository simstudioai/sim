import {
  documentedSchema,
  RATE_LIMIT_HEADERS,
  RESOURCE_ERRORS,
} from '@/lib/api/contracts/v2/openapi/shared'
import {
  MAX_MANIFEST_RESOURCES_PER_KIND,
  v2GetSourceResourcesContract,
} from '@/lib/api/contracts/v2/source-resources'
import { defineOpenApiRoute } from '@/lib/api/openapi/types'
import { workflowOperations } from '@/lib/workflows/application/operations'

const SOURCE_RESOURCES_EXAMPLE = {
  workspaceId: 'a91c4b2e-6d3f-4e8a-b5c7-0d9e2f1a8c64',
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
  credentials: [
    { key: 'support-slack', id: 'cred_51d0b8f4', name: 'Support Slack', provider: 'slack' },
  ],
  workflows: [
    {
      key: 'assign-owner',
      id: '3b1f7c92-8d4e-4a6b-9c0d-5e2f8a714b36',
      name: 'Assign owner',
      inputs: [{ name: 'leads', type: 'array' }],
    },
  ],
  skills: [{ key: 'triage', id: 'skl_7e2a4c19', name: 'Triage' }],
  customTools: [{ key: 'lookup-order', id: 'ctl_2b8d6f03', name: 'lookup_order' }],
  mcpServers: [
    { key: 'github', id: 'mcp-1a2b3c4d', name: 'GitHub', tools: ['create_issue', 'list_issues'] },
  ],
  env: ['CRM_KEY'],
  truncated: false,
}

export const sourceResourcesOpenApiRoutes = [
  defineOpenApiRoute(
    v2GetSourceResourcesContract,
    {
      applicationOperation: workflowOperations.readSourceResources,
      operationId: 'getSourceResources',
      summary: 'Get source resources',
      description: `List the workspace resources workflow source can name, each with the key source uses for it: tables with their columns, knowledge bases, saved credentials with their provider, workflows with their start-block inputs, workspace skills and custom tools, MCP servers with the tool names they list, and the names (never values) of the environment variables a run can read. A resource keeps its key when renamed; one that no source has named yet is given its key by this call. Each kind lists its oldest ${MAX_MANIFEST_RESOURCES_PER_KIND} resources, and \`truncated\` says when there were more. Returns \`403\` while workflows as code is not enabled.`,
      tags: ['Workflows'],
      errors: RESOURCE_ERRORS,
      success: {
        description: 'The resources workflow source can name.',
        headers: RATE_LIMIT_HEADERS,
      },
    },
    {
      query: v2GetSourceResourcesContract.query,
      params: documentedSchema(
        v2GetSourceResourcesContract.params,
        'GetSourceResourcesParams',
        'Get source resources path parameters',
        'Workspace whose resources to list.'
      ),
      response: documentedSchema(
        v2GetSourceResourcesContract.response.schema,
        'GetSourceResourcesResponse',
        'Get source resources response',
        'The workspace resources workflow source can name.',
        [{ data: SOURCE_RESOURCES_EXAMPLE }]
      ),
    }
  ),
]
