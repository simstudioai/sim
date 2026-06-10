import type {
  AppConfigCreateApplicationParams,
  AppConfigCreateApplicationResponse,
} from '@/tools/appconfig/types'
import type { ToolConfig } from '@/tools/types'

export const createApplicationTool: ToolConfig<
  AppConfigCreateApplicationParams,
  AppConfigCreateApplicationResponse
> = {
  id: 'appconfig_create_application',
  name: 'AppConfig Create Application',
  description: 'Create an application in AWS AppConfig',
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
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the application to create',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Description of the application',
    },
  },

  request: {
    url: '/api/tools/appconfig/create-application',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      name: params.name,
      description: params.description,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to create AppConfig application')
    }

    return {
      success: true,
      output: {
        message: data.message ?? '',
        id: data.id ?? '',
        name: data.name ?? '',
        description: data.description ?? null,
      },
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    id: { type: 'string', description: 'ID of the created application' },
    name: { type: 'string', description: 'Name of the created application' },
    description: {
      type: 'string',
      description: 'Description of the created application',
      optional: true,
    },
  },
}
