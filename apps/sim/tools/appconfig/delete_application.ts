import type {
  AppConfigDeleteApplicationParams,
  AppConfigDeleteResourceResponse,
} from '@/tools/appconfig/types'
import type { ToolConfig } from '@/tools/types'

export const deleteApplicationTool: ToolConfig<
  AppConfigDeleteApplicationParams,
  AppConfigDeleteResourceResponse
> = {
  id: 'appconfig_delete_application',
  name: 'AppConfig Delete Application',
  description: 'Delete an AWS AppConfig application',
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
      description: 'The application ID to delete',
    },
  },

  request: {
    url: '/api/tools/appconfig/delete-application',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      applicationId: params.applicationId,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to delete AppConfig application')
    }

    return {
      success: true,
      output: {
        message: data.message ?? '',
        id: data.id ?? '',
      },
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    id: { type: 'string', description: 'ID of the deleted application' },
  },
}
