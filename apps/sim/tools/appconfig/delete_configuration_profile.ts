import type {
  AppConfigDeleteConfigurationProfileParams,
  AppConfigDeleteResourceResponse,
} from '@/tools/appconfig/types'
import type { ToolConfig } from '@/tools/types'

export const deleteConfigurationProfileTool: ToolConfig<
  AppConfigDeleteConfigurationProfileParams,
  AppConfigDeleteResourceResponse
> = {
  id: 'appconfig_delete_configuration_profile',
  name: 'AppConfig Delete Configuration Profile',
  description: 'Delete an AWS AppConfig configuration profile',
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
      description: 'The configuration profile ID to delete',
    },
  },

  request: {
    url: '/api/tools/appconfig/delete-configuration-profile',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      applicationId: params.applicationId,
      configurationProfileId: params.configurationProfileId,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to delete AppConfig configuration profile')
    }

    return {
      success: true,
      output: {
        message: data.message ?? '',
        applicationId: data.applicationId ?? '',
        id: data.id ?? '',
      },
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    applicationId: { type: 'string', description: 'Owning application ID' },
    id: { type: 'string', description: 'ID of the deleted configuration profile' },
  },
}
