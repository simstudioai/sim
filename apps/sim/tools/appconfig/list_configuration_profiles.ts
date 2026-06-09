import type {
  AppConfigListConfigurationProfilesParams,
  AppConfigListConfigurationProfilesResponse,
} from '@/tools/appconfig/types'
import type { ToolConfig } from '@/tools/types'

export const listConfigurationProfilesTool: ToolConfig<
  AppConfigListConfigurationProfilesParams,
  AppConfigListConfigurationProfilesResponse
> = {
  id: 'appconfig_list_configuration_profiles',
  name: 'AppConfig List Configuration Profiles',
  description: 'List configuration profiles for an AWS AppConfig application',
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
      description: 'The application ID that owns the configuration profiles',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of configuration profiles to return (1-50)',
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
      maxResults: params.maxResults,
      nextToken: params.nextToken,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to list AppConfig configuration profiles')
    }

    return {
      success: true,
      output: {
        configurationProfiles: data.configurationProfiles ?? [],
        nextToken: data.nextToken ?? null,
        count: data.count ?? 0,
      },
    }
  },

  outputs: {
    configurationProfiles: {
      type: 'array',
      description: 'List of AppConfig configuration profiles',
      items: {
        type: 'object',
        properties: {
          applicationId: { type: 'string', description: 'Owning application ID' },
          id: { type: 'string', description: 'Configuration profile ID' },
          name: { type: 'string', description: 'Configuration profile name' },
          locationUri: {
            type: 'string',
            description: 'Location URI of the config',
            optional: true,
          },
          type: {
            type: 'string',
            description: 'Profile type (e.g., AWS.Freeform)',
            optional: true,
          },
          validatorTypes: { type: 'array', description: 'Validator types configured' },
        },
      },
    },
    nextToken: {
      type: 'string',
      description: 'Pagination token for the next page',
      optional: true,
    },
    count: { type: 'number', description: 'Number of configuration profiles returned' },
  },
}
