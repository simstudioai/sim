import type {
  AppConfigUpdateConfigurationProfileParams,
  AppConfigUpdateConfigurationProfileResponse,
} from '@/tools/appconfig/types'
import type { ToolConfig } from '@/tools/types'

export const updateConfigurationProfileTool: ToolConfig<
  AppConfigUpdateConfigurationProfileParams,
  AppConfigUpdateConfigurationProfileResponse
> = {
  id: 'appconfig_update_configuration_profile',
  name: 'AppConfig Update Configuration Profile',
  description:
    'Update the name, description, or retrieval role of an AppConfig configuration profile',
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
      description: 'The configuration profile ID to update',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New name for the configuration profile',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New description for the configuration profile',
    },
    retrievalRoleArn: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New ARN of the IAM role used to retrieve the configuration',
    },
  },

  request: {
    url: '/api/tools/appconfig/update-configuration-profile',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      applicationId: params.applicationId,
      configurationProfileId: params.configurationProfileId,
      name: params.name,
      description: params.description,
      retrievalRoleArn: params.retrievalRoleArn,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to update AppConfig configuration profile')
    }

    return {
      success: true,
      output: {
        message: data.message ?? '',
        applicationId: data.applicationId ?? '',
        id: data.id ?? '',
        name: data.name ?? '',
        description: data.description ?? null,
        type: data.type ?? null,
      },
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    applicationId: { type: 'string', description: 'Owning application ID' },
    id: { type: 'string', description: 'ID of the updated configuration profile' },
    name: { type: 'string', description: 'Name of the updated configuration profile' },
    description: { type: 'string', description: 'Description of the profile', optional: true },
    type: { type: 'string', description: 'Profile type', optional: true },
  },
}
