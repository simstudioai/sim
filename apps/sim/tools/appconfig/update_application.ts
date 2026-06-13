import type {
  AppConfigUpdateApplicationParams,
  AppConfigUpdateApplicationResponse,
} from '@/tools/appconfig/types'
import type { ToolConfig } from '@/tools/types'

export const updateApplicationTool: ToolConfig<
  AppConfigUpdateApplicationParams,
  AppConfigUpdateApplicationResponse
> = {
  id: 'appconfig_update_application',
  name: 'AppConfig Update Application',
  description: 'Update the name or description of an AWS AppConfig application',
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
      description: 'The application ID to update',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New name for the application',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New description for the application',
    },
  },

  request: {
    url: '/api/tools/appconfig/update-application',
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
      throw new Error(data.error || 'Failed to update AppConfig application')
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
    id: { type: 'string', description: 'ID of the updated application' },
    name: { type: 'string', description: 'Name of the updated application' },
    description: {
      type: 'string',
      description: 'Description of the updated application',
      optional: true,
    },
  },
}
