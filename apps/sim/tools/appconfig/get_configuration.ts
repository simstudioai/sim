import type {
  AppConfigGetConfigurationParams,
  AppConfigGetConfigurationResponse,
} from '@/tools/appconfig/types'
import type { ToolConfig } from '@/tools/types'

export const getConfigurationTool: ToolConfig<
  AppConfigGetConfigurationParams,
  AppConfigGetConfigurationResponse
> = {
  id: 'appconfig_get_configuration',
  name: 'AppConfig Get Configuration',
  description:
    'Retrieve the latest deployed configuration for an AppConfig application, environment, and profile',
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
      description: 'The application ID or name to retrieve configuration for',
    },
    environmentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The environment ID or name to retrieve configuration for',
    },
    configurationProfileId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The configuration profile ID or name to retrieve',
    },
  },

  request: {
    url: '/api/tools/appconfig/get-configuration',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      applicationId: params.applicationId,
      environmentId: params.environmentId,
      configurationProfileId: params.configurationProfileId,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to retrieve AppConfig configuration')
    }

    return {
      success: true,
      output: {
        configuration: data.configuration ?? '',
        contentType: data.contentType ?? null,
        versionLabel: data.versionLabel ?? null,
      },
    }
  },

  outputs: {
    configuration: { type: 'string', description: 'The deployed configuration content' },
    contentType: {
      type: 'string',
      description: 'Content type of the configuration',
      optional: true,
    },
    versionLabel: {
      type: 'string',
      description: 'Label of the retrieved configuration version',
      optional: true,
    },
  },
}
