import type {
  AppConfigGetEnvironmentParams,
  AppConfigGetEnvironmentResponse,
} from '@/tools/appconfig/types'
import type { ToolConfig } from '@/tools/types'

export const getEnvironmentTool: ToolConfig<
  AppConfigGetEnvironmentParams,
  AppConfigGetEnvironmentResponse
> = {
  id: 'appconfig_get_environment',
  name: 'AppConfig Get Environment',
  description: 'Get details about a single AWS AppConfig environment',
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
      description: 'The environment ID to retrieve',
    },
  },

  request: {
    url: '/api/tools/appconfig/get-environment',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      applicationId: params.applicationId,
      environmentId: params.environmentId,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to get AppConfig environment')
    }

    return {
      success: true,
      output: {
        applicationId: data.applicationId ?? '',
        id: data.id ?? '',
        name: data.name ?? '',
        description: data.description ?? null,
        state: data.state ?? null,
        monitors: data.monitors ?? [],
      },
    }
  },

  outputs: {
    applicationId: { type: 'string', description: 'Owning application ID' },
    id: { type: 'string', description: 'Environment ID' },
    name: { type: 'string', description: 'Environment name' },
    description: { type: 'string', description: 'Environment description', optional: true },
    state: { type: 'string', description: 'Environment state', optional: true },
    monitors: {
      type: 'array',
      description: 'CloudWatch alarms monitoring this environment',
      items: {
        type: 'object',
        properties: {
          alarmArn: { type: 'string', description: 'CloudWatch alarm ARN' },
          alarmRoleArn: {
            type: 'string',
            description: 'IAM role ARN for the alarm',
            optional: true,
          },
        },
      },
    },
  },
}
