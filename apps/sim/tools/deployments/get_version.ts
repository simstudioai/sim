import type {
  DeploymentsGetVersionParams,
  DeploymentsGetVersionResponse,
} from '@/tools/deployments/types'
import type { ToolConfig } from '@/tools/types'

export const deploymentsGetVersionTool: ToolConfig<
  DeploymentsGetVersionParams,
  DeploymentsGetVersionResponse
> = {
  id: 'deployments_get_version',
  name: 'Get Deployment Version',
  description:
    'Fetch a single deployment version of a workflow, including its metadata and the full workflow state snapshot that was deployed.',
  version: '1.0.0',

  params: {
    workflowId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the workflow',
    },
    version: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'The deployment version number to fetch',
    },
  },

  request: {
    url: (params) => {
      const workspaceId = params._context?.workspaceId
      if (!workspaceId) {
        throw new Error('workspaceId is required in execution context')
      }
      const qs = new URLSearchParams({
        workflowId: params.workflowId,
        workspaceId,
        version: String(params.version),
      })
      return `/api/tools/deployments/version?${qs.toString()}`
    },
    method: 'GET',
    headers: () => ({ 'Content-Type': 'application/json' }),
  },

  transformResponse: async (response) => response.json(),

  outputs: {
    workflowId: { type: 'string', description: 'ID of the workflow' },
    version: { type: 'number', description: 'The deployment version number' },
    name: { type: 'string', description: 'Version label', optional: true },
    description: { type: 'string', description: 'Version description', optional: true },
    isActive: { type: 'boolean', description: 'Whether this version is currently live' },
    createdAt: { type: 'string', description: 'When this version was deployed (ISO 8601)' },
    deployedState: {
      type: 'json',
      description: 'The full workflow state snapshot (blocks, edges, loops, parallels, variables)',
    },
  },
}
