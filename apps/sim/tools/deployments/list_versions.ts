import type {
  DeploymentsListVersionsParams,
  DeploymentsListVersionsResponse,
} from '@/tools/deployments/types'
import type { InternalToolConfig } from '@/tools/types'

export const deploymentsListVersionsTool: InternalToolConfig<
  DeploymentsListVersionsParams,
  DeploymentsListVersionsResponse
> = {
  id: 'deployments_list_versions',
  name: 'List Deployment Versions',
  description:
    'List every deployment version of a workflow, newest first, including which version is currently live.',
  version: '1.0.0',

  params: {
    workflowId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the workflow',
    },
  },

  operation: {
    input: (params) => ({ workflowId: params.workflowId }),
  },

  transformResponse: async (response) => response.json(),

  outputs: {
    workflowId: { type: 'string', description: 'ID of the workflow' },
    versions: {
      type: 'array',
      description:
        'Deployment versions, newest first (id, version, name, description, isActive, createdAt, createdBy, deployedByName)',
    },
  },
}
