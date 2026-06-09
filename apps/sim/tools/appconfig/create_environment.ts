import type {
  AppConfigCreateEnvironmentParams,
  AppConfigCreateEnvironmentResponse,
} from '@/tools/appconfig/types'
import type { ToolConfig } from '@/tools/types'

export const createEnvironmentTool: ToolConfig<
  AppConfigCreateEnvironmentParams,
  AppConfigCreateEnvironmentResponse
> = {
  id: 'appconfig_create_environment',
  name: 'AppConfig Create Environment',
  description: 'Create an environment for an AWS AppConfig application',
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
      description: 'The application ID to create the environment in',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the environment to create',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Description of the environment',
    },
  },

  request: {
    url: '/api/tools/appconfig/create-environment',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      applicationId: params.applicationId,
      name: params.name,
      description: params.description,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to create AppConfig environment')
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
    id: { type: 'string', description: 'ID of the created environment' },
    name: { type: 'string', description: 'Name of the created environment' },
    state: { type: 'string', description: 'State of the created environment', optional: true },
  },
}
