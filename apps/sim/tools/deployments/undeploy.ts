import type {
  DeploymentsUndeployParams,
  DeploymentsUndeployResponse,
} from '@/tools/deployments/types'
import type { InternalToolConfig } from '@/tools/types'

export const deploymentsUndeployTool: InternalToolConfig<
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

  operation: {
    input: (params) => ({ workflowId: params.workflowId }),
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
