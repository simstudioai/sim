import type {
  AppConfigListPaginatedParams,
  AppConfigListStrategiesResponse,
} from '@/tools/appconfig/types'
import type { ToolConfig } from '@/tools/types'

export const listDeploymentStrategiesTool: ToolConfig<
  AppConfigListPaginatedParams,
  AppConfigListStrategiesResponse
> = {
  id: 'appconfig_list_deployment_strategies',
  name: 'AppConfig List Deployment Strategies',
  description: 'List AppConfig deployment strategies in the account',
  version: '1.0.0',

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
      description: 'Maximum number of strategies to return (1-50)',
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
      ...(params.maxResults !== undefined && { maxResults: params.maxResults }),
      ...(params.nextToken !== undefined && { nextToken: params.nextToken }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.error || 'AppConfig list deployment strategies failed')
    }
    return { success: true, output: data }
  },

  outputs: {
    items: {
      type: 'array',
      description: 'List of deployment strategy summaries',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'The deployment strategy ID', optional: true },
          name: { type: 'string', description: 'The deployment strategy name', optional: true },
          description: {
            type: 'string',
            description: 'The deployment strategy description',
            optional: true,
          },
          deploymentDurationInMinutes: {
            type: 'number',
            description: 'Total deployment duration in minutes',
            optional: true,
          },
          growthType: {
            type: 'string',
            description: 'How percentage grows over time (LINEAR or EXPONENTIAL)',
            optional: true,
          },
          growthFactor: {
            type: 'number',
            description: 'Percentage of targets per interval',
            optional: true,
          },
          finalBakeTimeInMinutes: {
            type: 'number',
            description: 'Bake time in minutes before completion',
            optional: true,
          },
          replicateTo: {
            type: 'string',
            description: 'Where the strategy is replicated (NONE or SSM_DOCUMENT)',
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
  },
}
