import type {
  AppConfigListHostedConfigurationVersionsParams,
  AppConfigListHostedConfigurationVersionsResponse,
} from '@/tools/appconfig/types'
import type { ToolConfig } from '@/tools/types'

export const listHostedConfigurationVersionsTool: ToolConfig<
  AppConfigListHostedConfigurationVersionsParams,
  AppConfigListHostedConfigurationVersionsResponse
> = {
  id: 'appconfig_list_hosted_configuration_versions',
  name: 'AppConfig List Hosted Configuration Versions',
  description: 'List hosted configuration versions for an AWS AppConfig configuration profile',
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
      description: 'The application ID that owns the configuration profile',
    },
    configurationProfileId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The configuration profile ID to list versions for',
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
      maxResults: params.maxResults,
      nextToken: params.nextToken,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to list AppConfig hosted configuration versions')
    }

    return {
      success: true,
      output: {
        versions: data.versions ?? [],
        nextToken: data.nextToken ?? null,
        count: data.count ?? 0,
      },
    }
  },

  outputs: {
    versions: {
      type: 'array',
      description: 'List of hosted configuration versions',
      items: {
        type: 'object',
        properties: {
          applicationId: { type: 'string', description: 'Owning application ID', optional: true },
          configurationProfileId: {
            type: 'string',
            description: 'Owning configuration profile ID',
            optional: true,
          },
          versionNumber: { type: 'number', description: 'Version number', optional: true },
          description: {
            type: 'string',
            description: 'Description of the version',
            optional: true,
          },
          contentType: {
            type: 'string',
            description: 'Content type of the configuration',
            optional: true,
          },
          versionLabel: {
            type: 'string',
            description: 'Label of the configuration version',
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
    count: { type: 'number', description: 'Number of versions returned' },
  },
}
