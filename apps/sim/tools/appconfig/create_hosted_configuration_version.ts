import type {
  AppConfigCreateHostedConfigurationVersionParams,
  AppConfigCreateHostedConfigurationVersionResponse,
} from '@/tools/appconfig/types'
import type { ToolConfig } from '@/tools/types'

export const createHostedConfigurationVersionTool: ToolConfig<
  AppConfigCreateHostedConfigurationVersionParams,
  AppConfigCreateHostedConfigurationVersionResponse
> = {
  id: 'appconfig_create_hosted_configuration_version',
  name: 'AppConfig Create Hosted Configuration Version',
  description: 'Create a new hosted configuration version for an AppConfig configuration profile',
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
      description: 'The configuration profile ID to add the version to',
    },
    content: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The configuration content (e.g., a JSON or YAML document)',
    },
    contentType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Content type of the configuration (e.g., application/json, text/plain)',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Description of the configuration version',
    },
    latestVersionNumber: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'The version number of the latest version, used for optimistic concurrency',
    },
    versionLabel: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'A user-defined label for the configuration version',
    },
  },

  request: {
    url: '/api/tools/appconfig/create-hosted-configuration-version',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      applicationId: params.applicationId,
      configurationProfileId: params.configurationProfileId,
      content: params.content,
      contentType: params.contentType,
      description: params.description,
      latestVersionNumber: params.latestVersionNumber,
      versionLabel: params.versionLabel,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to create AppConfig hosted configuration version')
    }

    return {
      success: true,
      output: {
        message: data.message ?? '',
        applicationId: data.applicationId ?? '',
        configurationProfileId: data.configurationProfileId ?? '',
        versionNumber: data.versionNumber ?? null,
        contentType: data.contentType ?? null,
        versionLabel: data.versionLabel ?? null,
      },
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    applicationId: { type: 'string', description: 'Owning application ID' },
    configurationProfileId: { type: 'string', description: 'Owning configuration profile ID' },
    versionNumber: {
      type: 'number',
      description: 'Version number of the created configuration',
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
}
