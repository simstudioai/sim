import type {
  AppConfigListApplicationsParams,
  AppConfigListApplicationsResponse,
} from '@/tools/appconfig/types'
import type { ToolConfig } from '@/tools/types'

export const listApplicationsTool: ToolConfig<
  AppConfigListApplicationsParams,
  AppConfigListApplicationsResponse
> = {
  id: 'appconfig_list_applications',
  name: 'AppConfig List Applications',
  description: 'List applications in AWS AppConfig',
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
      description: 'Maximum number of applications to return (1-50)',
    },
    nextToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination token from a previous response',
    },
  },

  request: {
    url: '/api/tools/appconfig/list-applications',
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
      throw new Error(data.error || 'Failed to list AppConfig applications')
    }

    return {
      success: true,
      output: {
        applications: data.applications ?? [],
        nextToken: data.nextToken ?? null,
        count: data.count ?? 0,
      },
    }
  },

  outputs: {
    applications: {
      type: 'array',
      description: 'List of AppConfig applications',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Application ID' },
          name: { type: 'string', description: 'Application name' },
          description: { type: 'string', description: 'Application description', optional: true },
        },
      },
    },
    nextToken: {
      type: 'string',
      description: 'Pagination token for the next page',
      optional: true,
    },
    count: { type: 'number', description: 'Number of applications returned' },
  },
}
