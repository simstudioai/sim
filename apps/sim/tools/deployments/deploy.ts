import type { DeploymentsDeployParams, DeploymentsDeployResponse } from '@/tools/deployments/types'
import type { InternalToolConfig } from '@/tools/types'

export const deploymentsDeployTool: InternalToolConfig<
  DeploymentsDeployParams,
  DeploymentsDeployResponse
> = {
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

  operation: {
    input: (params) => ({
      workflowId: params.workflowId,
      ...(params.name ? { name: params.name } : {}),
      ...(params.description ? { description: params.description } : {}),
    }),
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
