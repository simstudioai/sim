import type {
  AppConfigUpdateEnvironmentParams,
  AppConfigUpdateEnvironmentResponse,
} from '@/tools/appconfig/types'
import type { ToolConfig } from '@/tools/types'

export const updateEnvironmentTool: ToolConfig<
  AppConfigUpdateEnvironmentParams,
  AppConfigUpdateEnvironmentResponse
> = {
  id: 'appconfig_update_environment',
  name: 'AppConfig Update Environment',
  description: 'Update the name or description of an AWS AppConfig environment',
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
      description: 'The application ID that owns the environment',
    },
    environmentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The environment ID to update',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New name for the environment',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New description for the environment',
    },
  },

  request: {
    url: '/api/tools/appconfig/update-environment',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      applicationId: params.applicationId,
      environmentId: params.environmentId,
      name: params.name,
      description: params.description,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to update AppConfig environment')
    }

    return {
      success: true,
      output: {
        message: data.message ?? '',
        applicationId: data.applicationId ?? '',
        id: data.id ?? '',
        name: data.name ?? '',
        state: data.state ?? null,
      },
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    applicationId: { type: 'string', description: 'Owning application ID' },
    id: { type: 'string', description: 'ID of the updated environment' },
    name: { type: 'string', description: 'Name of the updated environment' },
    state: { type: 'string', description: 'State of the updated environment', optional: true },
  },
}
