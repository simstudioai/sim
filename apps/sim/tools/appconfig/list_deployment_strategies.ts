import type {
  AppConfigListDeploymentStrategiesParams,
  AppConfigListDeploymentStrategiesResponse,
} from '@/tools/appconfig/types'
import type { ToolConfig } from '@/tools/types'

export const listDeploymentStrategiesTool: ToolConfig<
  AppConfigListDeploymentStrategiesParams,
  AppConfigListDeploymentStrategiesResponse
> = {
  id: 'appconfig_list_deployment_strategies',
  name: 'AppConfig List Deployment Strategies',
  description: 'List deployment strategies available in AWS AppConfig',
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
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of deployment strategies to return (1-50)',
    },
    nextToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination token from a previous response',
    },
  },

  request: {
    url: '/api/tools/appconfig/list-deployment-strategies',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      maxResults: params.maxResults,
      nextToken: params.nextToken,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to list AppConfig deployment strategies')
    }

    return {
      success: true,
      output: {
        deploymentStrategies: data.deploymentStrategies ?? [],
        nextToken: data.nextToken ?? null,
        count: data.count ?? 0,
      },
    }
  },

  outputs: {
    deploymentStrategies: {
      type: 'array',
      description: 'List of AppConfig deployment strategies',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Deployment strategy ID' },
          name: { type: 'string', description: 'Deployment strategy name' },
          description: { type: 'string', description: 'Strategy description', optional: true },
          deploymentDurationInMinutes: {
            type: 'number',
            description: 'Total deployment duration in minutes',
            optional: true,
          },
          growthType: {
            type: 'string',
            description: 'Growth type (LINEAR or EXPONENTIAL)',
            optional: true,
          },
          growthFactor: { type: 'number', description: 'Growth factor percentage', optional: true },
          finalBakeTimeInMinutes: {
            type: 'number',
            description: 'Final bake time in minutes',
            optional: true,
          },
          replicateTo: {
            type: 'string',
            description: 'Where the strategy is replicated',
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
    count: { type: 'number', description: 'Number of deployment strategies returned' },
  },
}
