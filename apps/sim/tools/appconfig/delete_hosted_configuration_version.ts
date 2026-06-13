import type {
  AppConfigDeleteHostedConfigurationVersionParams,
  AppConfigDeleteHostedConfigurationVersionResponse,
} from '@/tools/appconfig/types'
import type { ToolConfig } from '@/tools/types'

export const deleteHostedConfigurationVersionTool: ToolConfig<
  AppConfigDeleteHostedConfigurationVersionParams,
  AppConfigDeleteHostedConfigurationVersionResponse
> = {
  id: 'appconfig_delete_hosted_configuration_version',
  name: 'AppConfig Delete Hosted Configuration Version',
  description: 'Delete a specific hosted configuration version from an AppConfig profile',
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
      description: 'The configuration profile ID that owns the version',
    },
    versionNumber: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'The version number to delete',
    },
  },

  request: {
    url: '/api/tools/appconfig/delete-hosted-configuration-version',
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
      throw new Error(data.error || 'Failed to delete AppConfig hosted configuration version')
    }

    return {
      success: true,
      output: {
        message: data.message ?? '',
        applicationId: data.applicationId ?? '',
        configurationProfileId: data.configurationProfileId ?? '',
        versionNumber: data.versionNumber ?? 0,
      },
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    applicationId: { type: 'string', description: 'Owning application ID' },
    configurationProfileId: { type: 'string', description: 'Owning configuration profile ID' },
    versionNumber: { type: 'number', description: 'Version number that was deleted' },
  },
}
