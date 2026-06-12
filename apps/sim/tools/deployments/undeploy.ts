import type {
  DeploymentsUndeployParams,
  DeploymentsUndeployResponse,
} from '@/tools/deployments/types'
import type { ToolConfig } from '@/tools/types'

export const deploymentsUndeployTool: ToolConfig<
  DeploymentsUndeployParams,
  DeploymentsUndeployResponse
> = {
  id: 'deployments_undeploy',
  name: 'Undeploy Workflow',
  description:
    'Take a deployed workflow offline. API execution stops and schedules, webhooks, and other deployment side effects are removed. Requires admin permission on the workflow’s workspace.',
  version: '1.0.0',

  params: {
    workflowId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the workflow to undeploy',
    },
  },

  request: {
    url: '/api/tools/deployments/undeploy',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => {
      const workspaceId = params._context?.workspaceId
      if (!workspaceId) {
        throw new Error('workspaceId is required in execution context')
      }
      return { workflowId: params.workflowId, workspaceId }
    },
  },

  transformResponse: async (response) => response.json(),

  outputs: {
    workflowId: { type: 'string', description: 'ID of the undeployed workflow' },
    isDeployed: { type: 'boolean', description: 'Whether the workflow is still deployed (false)' },
    deployedAt: {
      type: 'string',
      description: 'Always null after an undeploy',
      optional: true,
    },
    warnings: {
      type: 'array',
      description: 'Non-fatal warnings (e.g. trigger or schedule cleanup still in progress)',
    },
  },
}
