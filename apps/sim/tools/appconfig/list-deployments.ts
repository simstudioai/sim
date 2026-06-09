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
  description: 'List deployments for an AppConfig environment',
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
    applicationId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The AppConfig application ID',
    },
    environmentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The environment ID',
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
      ...(params.maxResults !== undefined && { maxResults: params.maxResults }),
      ...(params.nextToken !== undefined && { nextToken: params.nextToken }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.error || 'AppConfig list deployments failed')
    }
    return { success: true, output: data }
  },

  outputs: {
    items: {
      type: 'array',
      description: 'List of deployment summaries',
      items: {
        type: 'object',
        properties: {
          deploymentNumber: {
            type: 'number',
            description: 'The deployment sequence number',
            optional: true,
          },
          configurationName: {
            type: 'string',
            description: 'The configuration name',
            optional: true,
          },
          configurationVersion: {
            type: 'string',
            description: 'The deployed configuration version',
            optional: true,
          },
          state: { type: 'string', description: 'The deployment state', optional: true },
          percentageComplete: {
            type: 'number',
            description: 'Percentage of targets deployed',
            optional: true,
          },
          startedAt: {
            type: 'string',
            description: 'When the deployment started (ISO)',
            optional: true,
          },
          completedAt: {
            type: 'string',
            description: 'When the deployment completed (ISO)',
            optional: true,
          },
          versionLabel: { type: 'string', description: 'The version label', optional: true },
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
