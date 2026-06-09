import type {
  AppConfigListVersionsParams,
  AppConfigListVersionsResponse,
} from '@/tools/appconfig/types'
import type { ToolConfig } from '@/tools/types'

export const listHostedConfigurationVersionsTool: ToolConfig<
  AppConfigListVersionsParams,
  AppConfigListVersionsResponse
> = {
  id: 'appconfig_list_hosted_configuration_versions',
  name: 'AppConfig List Hosted Configuration Versions',
  description: 'List hosted configuration versions for an AppConfig configuration profile',
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
    configurationProfileId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The configuration profile ID',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of versions to return (1-50)',
    },
    nextToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination token from a previous response',
    },
  },

  request: {
    url: '/api/tools/appconfig/list-hosted-configuration-versions',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      applicationId: params.applicationId,
      configurationProfileId: params.configurationProfileId,
      ...(params.maxResults !== undefined && { maxResults: params.maxResults }),
      ...(params.nextToken !== undefined && { nextToken: params.nextToken }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.error || 'AppConfig list hosted configuration versions failed')
    }
    return { success: true, output: data }
  },

  outputs: {
    items: {
      type: 'array',
      description: 'List of hosted configuration version summaries',
      items: {
        type: 'object',
        properties: {
          applicationId: { type: 'string', description: 'The application ID', optional: true },
          configurationProfileId: {
            type: 'string',
            description: 'The configuration profile ID',
            optional: true,
          },
          versionNumber: { type: 'number', description: 'The version number', optional: true },
          description: { type: 'string', description: 'The version description', optional: true },
          contentType: { type: 'string', description: 'The content MIME type', optional: true },
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
