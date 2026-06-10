import type {
  AppConfigCreateConfigurationProfileParams,
  AppConfigCreateConfigurationProfileResponse,
} from '@/tools/appconfig/types'
import type { ToolConfig } from '@/tools/types'

export const createConfigurationProfileTool: ToolConfig<
  AppConfigCreateConfigurationProfileParams,
  AppConfigCreateConfigurationProfileResponse
> = {
  id: 'appconfig_create_configuration_profile',
  name: 'AppConfig Create Configuration Profile',
  description: 'Create a configuration profile in an AWS AppConfig application',
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
      description: 'The application ID to create the configuration profile in',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the configuration profile',
    },
    locationUri: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Where the configuration is stored. Use "hosted" for AppConfig-hosted configurations, or an SSM/S3 URI',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Description of the configuration profile',
    },
    retrievalRoleArn: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'ARN of an IAM role to retrieve the configuration (required for non-hosted URIs)',
    },
    type: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Profile type: AWS.Freeform (default) or AWS.AppConfig.FeatureFlags',
    },
  },

  request: {
    url: '/api/tools/appconfig/create-configuration-profile',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      applicationId: params.applicationId,
      name: params.name,
      locationUri: params.locationUri,
      description: params.description,
      retrievalRoleArn: params.retrievalRoleArn,
      type: params.type,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to create AppConfig configuration profile')
    }

    return {
      success: true,
      output: {
        message: data.message ?? '',
        applicationId: data.applicationId ?? '',
        id: data.id ?? '',
        name: data.name ?? '',
        locationUri: data.locationUri ?? null,
        type: data.type ?? null,
      },
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    applicationId: { type: 'string', description: 'Owning application ID' },
    id: { type: 'string', description: 'ID of the created configuration profile' },
    name: { type: 'string', description: 'Name of the created configuration profile' },
    locationUri: { type: 'string', description: 'Location URI of the config', optional: true },
    type: { type: 'string', description: 'Profile type', optional: true },
  },
}
