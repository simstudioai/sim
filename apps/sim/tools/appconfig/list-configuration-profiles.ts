import type {
  AppConfigListProfilesParams,
  AppConfigListProfilesResponse,
} from '@/tools/appconfig/types'
import type { ToolConfig } from '@/tools/types'

export const listConfigurationProfilesTool: ToolConfig<
  AppConfigListProfilesParams,
  AppConfigListProfilesResponse
> = {
  id: 'appconfig_list_configuration_profiles',
  name: 'AppConfig List Configuration Profiles',
  description: 'List configuration profiles for an AppConfig application',
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
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of profiles to return (1-50)',
    },
    nextToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination token from a previous response',
    },
  },

  request: {
    url: '/api/tools/appconfig/list-configuration-profiles',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      applicationId: params.applicationId,
      ...(params.maxResults !== undefined && { maxResults: params.maxResults }),
      ...(params.nextToken !== undefined && { nextToken: params.nextToken }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.error || 'AppConfig list configuration profiles failed')
    }
    return { success: true, output: data }
  },

  outputs: {
    items: {
      type: 'array',
      description: 'List of configuration profile summaries',
      items: {
        type: 'object',
        properties: {
          applicationId: { type: 'string', description: 'The application ID', optional: true },
          id: { type: 'string', description: 'The configuration profile ID', optional: true },
          name: { type: 'string', description: 'The configuration profile name', optional: true },
          locationUri: {
            type: 'string',
            description: 'The configuration source location URI',
            optional: true,
          },
          type: {
            type: 'string',
            description: 'The configuration profile type',
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
