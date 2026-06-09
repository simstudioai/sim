import type {
  AppConfigGetApplicationParams,
  AppConfigGetApplicationResponse,
} from '@/tools/appconfig/types'
import type { ToolConfig } from '@/tools/types'

export const getApplicationTool: ToolConfig<
  AppConfigGetApplicationParams,
  AppConfigGetApplicationResponse
> = {
  id: 'appconfig_get_application',
  name: 'AppConfig Get Application',
  description: 'Get details about a single AWS AppConfig application',
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
      description: 'The application ID to retrieve',
    },
  },

  request: {
    url: '/api/tools/appconfig/get-application',
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
      throw new Error(data.error || 'Failed to get AppConfig application')
    }

    return {
      success: true,
      output: {
        id: data.id ?? '',
        name: data.name ?? '',
        description: data.description ?? null,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Application ID' },
    name: { type: 'string', description: 'Application name' },
    description: { type: 'string', description: 'Application description', optional: true },
  },
}
