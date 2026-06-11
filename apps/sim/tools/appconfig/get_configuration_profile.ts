import type {
  AppConfigGetConfigurationProfileParams,
  AppConfigGetConfigurationProfileResponse,
} from '@/tools/appconfig/types'
import type { ToolConfig } from '@/tools/types'

export const getConfigurationProfileTool: ToolConfig<
  AppConfigGetConfigurationProfileParams,
  AppConfigGetConfigurationProfileResponse
> = {
  id: 'appconfig_get_configuration_profile',
  name: 'AppConfig Get Configuration Profile',
  description: 'Get details about a single AWS AppConfig configuration profile',
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
      description: 'The configuration profile ID to retrieve',
    },
  },

  request: {
    url: '/api/tools/appconfig/get-configuration-profile',
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
      throw new Error(data.error || 'Failed to get AppConfig configuration profile')
    }

    return {
      success: true,
      output: {
        applicationId: data.applicationId ?? '',
        id: data.id ?? '',
        name: data.name ?? '',
        description: data.description ?? null,
        locationUri: data.locationUri ?? null,
        retrievalRoleArn: data.retrievalRoleArn ?? null,
        type: data.type ?? null,
        validators: data.validators ?? [],
      },
    }
  },

  outputs: {
    applicationId: { type: 'string', description: 'Owning application ID' },
    id: { type: 'string', description: 'Configuration profile ID' },
    name: { type: 'string', description: 'Configuration profile name' },
    description: { type: 'string', description: 'Profile description', optional: true },
    locationUri: { type: 'string', description: 'Location URI of the config', optional: true },
    retrievalRoleArn: { type: 'string', description: 'IAM retrieval role ARN', optional: true },
    type: { type: 'string', description: 'Profile type (e.g., AWS.Freeform)', optional: true },
    validators: {
      type: 'array',
      description: 'Validators configured on the profile',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', description: 'Validator type (JSON_SCHEMA or LAMBDA)' },
        },
      },
    },
  },
}
