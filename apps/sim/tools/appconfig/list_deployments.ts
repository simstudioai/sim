import type {
  AppConfigListDeploymentsParams,
  AppConfigListDeploymentsResponse,
} from '@/tools/appconfig/types'
import type { ToolConfig } from '@/tools/types'

export const listDeploymentsTool: ToolConfig<
  AppConfigListDeploymentsParams,
  AppConfigListDeploymentsResponse
> = {
  id: 'appconfig_list_deployments',
  name: 'AppConfig List Deployments',
  description: 'List deployments for an AWS AppConfig environment',
  version: '1.0',

  params: {
    region: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS region (e.g., us-east-1)',
    },
    accessKeyId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS access key ID',
    },
    secretAccessKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS secret access key',
    },
    applicationId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The application ID of the deployments',
    },
    environmentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The environment ID of the deployments',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of deployments to return (1-50)',
    },
    nextToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination token from a previous response',
    },
  },

  request: {
    url: '/api/tools/appconfig/list-deployments',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      applicationId: params.applicationId,
      environmentId: params.environmentId,
      maxResults: params.maxResults,
      nextToken: params.nextToken,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to list AppConfig deployments')
    }

    return {
      success: true,
      output: {
        deployments: data.deployments ?? [],
        nextToken: data.nextToken ?? null,
        count: data.count ?? 0,
      },
    }
  },

  outputs: {
    deployments: {
      type: 'array',
      description: 'List of AppConfig deployments',
      items: {
        type: 'object',
        properties: {
          deploymentNumber: {
            type: 'number',
            description: 'Deployment sequence number',
            optional: true,
          },
          configurationName: { type: 'string', description: 'Configuration name', optional: true },
          configurationVersion: {
            type: 'string',
            description: 'Configuration version',
            optional: true,
          },
          state: { type: 'string', description: 'Current deployment state', optional: true },
          percentageComplete: {
            type: 'number',
            description: 'Percentage completed',
            optional: true,
          },
          startedAt: { type: 'string', description: 'When the deployment started', optional: true },
          completedAt: {
            type: 'string',
            description: 'When the deployment completed',
            optional: true,
          },
          versionLabel: {
            type: 'string',
            description: 'Configuration version label',
            optional: true,
          },
        },
      },
    },
    nextToken: {
      type: 'string',
      description: 'Pagination token for the next page',
      optional: true,
    },
    count: { type: 'number', description: 'Number of deployments returned' },
  },
}
