import type {
  AppConfigListApplicationsResponse,
  AppConfigListPaginatedParams,
} from '@/tools/appconfig/types'
import type { ToolConfig } from '@/tools/types'

export const listApplicationsTool: ToolConfig<
  AppConfigListPaginatedParams,
  AppConfigListApplicationsResponse
> = {
  id: 'appconfig_list_applications',
  name: 'AppConfig List Applications',
  description: 'List AppConfig applications in the account',
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
      ...(params.maxResults !== undefined && { maxResults: params.maxResults }),
      ...(params.nextToken !== undefined && { nextToken: params.nextToken }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.error || 'AppConfig list applications failed')
    }
    return { success: true, output: data }
  },

  outputs: {
    items: {
      type: 'array',
      description: 'List of application summaries',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'The application ID', optional: true },
          name: { type: 'string', description: 'The application name', optional: true },
          description: {
            type: 'string',
            description: 'The application description',
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
