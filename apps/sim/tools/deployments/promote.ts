import type {
  DeploymentsPromoteParams,
  DeploymentsPromoteResponse,
} from '@/tools/deployments/types'
import type { ToolConfig } from '@/tools/types'

export const deploymentsPromoteTool: ToolConfig<
  DeploymentsPromoteParams,
  DeploymentsPromoteResponse
> = {
  id: 'deployments_promote',
  name: 'Promote Version to Live',
  description:
    'Make a specific deployment version the live one without creating a new version — the same operation as Promote to live in the deploy modal. Useful for rolling back to a known-good version. Also works on an undeployed workflow: it re-deploys the workflow live at that version. Requires admin permission on the workflow’s workspace.',
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
      description: 'The deployment version number to promote to live',
    },
  },

  request: {
    url: '/api/tools/deployments/promote',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => {
      const workspaceId = params._context?.workspaceId
      if (!workspaceId) {
        throw new Error('workspaceId is required in execution context')
      }
      return {
        workflowId: params.workflowId,
        workspaceId,
        version: Number(params.version),
      }
    },
  },

  transformResponse: async (response) => response.json(),

  outputs: {
    workflowId: { type: 'string', description: 'ID of the workflow' },
    isDeployed: { type: 'boolean', description: 'Whether the workflow is now deployed' },
    deployedAt: {
      type: 'string',
      description: 'ISO 8601 timestamp of the active deployment (null if unavailable)',
    },
    version: { type: 'number', description: 'The deployment version that is now live' },
    warnings: {
      type: 'array',
      description: 'Non-fatal warnings (e.g. trigger or schedule sync still in progress)',
    },
  },
}
