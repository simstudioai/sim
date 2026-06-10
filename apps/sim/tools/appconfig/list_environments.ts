import type {
  AppConfigListEnvironmentsParams,
  AppConfigListEnvironmentsResponse,
} from '@/tools/appconfig/types'
import type { ToolConfig } from '@/tools/types'

export const listEnvironmentsTool: ToolConfig<
  AppConfigListEnvironmentsParams,
  AppConfigListEnvironmentsResponse
> = {
  id: 'appconfig_list_environments',
  name: 'AppConfig List Environments',
  description: 'List environments for an AWS AppConfig application',
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
      description: 'The application ID that owns the environments',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of environments to return (1-50)',
    },
    nextToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination token from a previous response',
    },
  },

  request: {
    url: '/api/tools/appconfig/list-environments',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      applicationId: params.applicationId,
      maxResults: params.maxResults,
      nextToken: params.nextToken,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to list AppConfig environments')
    }

    return {
      success: true,
      output: {
        environments: data.environments ?? [],
        nextToken: data.nextToken ?? null,
        count: data.count ?? 0,
      },
    }
  },

  outputs: {
    environments: {
      type: 'array',
      description: 'List of AppConfig environments',
      items: {
        type: 'object',
        properties: {
          applicationId: { type: 'string', description: 'Owning application ID' },
          id: { type: 'string', description: 'Environment ID' },
          name: { type: 'string', description: 'Environment name' },
          description: { type: 'string', description: 'Environment description', optional: true },
          state: { type: 'string', description: 'Environment state', optional: true },
        },
      },
    },
    nextToken: {
      type: 'string',
      description: 'Pagination token for the next page',
      optional: true,
    },
    count: { type: 'number', description: 'Number of environments returned' },
  },
}
