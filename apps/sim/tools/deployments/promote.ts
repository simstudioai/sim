import type {
  DeploymentsPromoteParams,
  DeploymentsPromoteResponse,
} from '@/tools/deployments/types'
import type { InternalToolConfig } from '@/tools/types'

export const deploymentsPromoteTool: InternalToolConfig<
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

  operation: {
    input: (params) => ({
      workflowId: params.workflowId,
      version: Number(params.version),
    }),
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
