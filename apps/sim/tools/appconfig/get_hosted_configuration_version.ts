import type {
  AppConfigGetHostedConfigurationVersionParams,
  AppConfigGetHostedConfigurationVersionResponse,
} from '@/tools/appconfig/types'
import type { ToolConfig } from '@/tools/types'

export const getHostedConfigurationVersionTool: ToolConfig<
  AppConfigGetHostedConfigurationVersionParams,
  AppConfigGetHostedConfigurationVersionResponse
> = {
  id: 'appconfig_get_hosted_configuration_version',
  name: 'AppConfig Get Hosted Configuration Version',
  description: 'Retrieve a specific hosted configuration version from an AppConfig profile',
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
      description: 'The configuration profile ID to read the version from',
    },
    versionNumber: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'The version number to retrieve',
    },
  },

  request: {
    url: '/api/tools/appconfig/get-hosted-configuration-version',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      applicationId: params.applicationId,
      configurationProfileId: params.configurationProfileId,
      versionNumber: params.versionNumber,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to get AppConfig hosted configuration version')
    }

    return {
      success: true,
      output: {
        applicationId: data.applicationId ?? '',
        configurationProfileId: data.configurationProfileId ?? '',
        versionNumber: data.versionNumber ?? null,
        description: data.description ?? null,
        content: data.content ?? '',
        contentType: data.contentType ?? null,
        versionLabel: data.versionLabel ?? null,
      },
    }
  },

  outputs: {
    applicationId: { type: 'string', description: 'Owning application ID' },
    configurationProfileId: { type: 'string', description: 'Owning configuration profile ID' },
    versionNumber: { type: 'number', description: 'Version number', optional: true },
    description: { type: 'string', description: 'Description of the version', optional: true },
    content: { type: 'string', description: 'The configuration content' },
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
}
