import type { DeploymentsDeployParams, DeploymentsDeployResponse } from '@/tools/deployments/types'
import type { ToolConfig } from '@/tools/types'

export const deploymentsDeployTool: ToolConfig<DeploymentsDeployParams, DeploymentsDeployResponse> =
  {
    id: 'deployments_deploy',
    name: 'Deploy Workflow',
    description:
      'Deploy a workflow’s current draft state, creating a new deployment version and making it live for API execution. Requires admin permission on the workflow’s workspace.',
    version: '1.0.0',

    params: {
      workflowId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'ID of the workflow to deploy',
      },
      name: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Optional label for the new deployment version',
      },
      description: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Optional summary of what changed in this version',
      },
    },

    request: {
      url: '/api/tools/deployments/deploy',
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
          ...(params.name ? { name: params.name } : {}),
          ...(params.description ? { description: params.description } : {}),
        }
      },
    },

    transformResponse: async (response) => response.json(),

    outputs: {
      workflowId: { type: 'string', description: 'ID of the deployed workflow' },
      isDeployed: { type: 'boolean', description: 'Whether the workflow is now deployed' },
      deployedAt: {
        type: 'string',
        description: 'ISO 8601 timestamp of the deployment (null if unavailable)',
      },
      version: {
        type: 'number',
        description: 'The deployment version that is now active',
        optional: true,
      },
      warnings: {
        type: 'array',
        description: 'Non-fatal warnings (e.g. trigger or schedule sync still in progress)',
      },
    },
  }
