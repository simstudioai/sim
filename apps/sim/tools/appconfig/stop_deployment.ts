import type {
  AppConfigStopDeploymentParams,
  AppConfigStopDeploymentResponse,
} from '@/tools/appconfig/types'
import type { ToolConfig } from '@/tools/types'

export const stopDeploymentTool: ToolConfig<
  AppConfigStopDeploymentParams,
  AppConfigStopDeploymentResponse
> = {
  id: 'appconfig_stop_deployment',
  name: 'AppConfig Stop Deployment',
  description: 'Stop an in-progress AWS AppConfig deployment',
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
      description: 'The application ID of the deployment',
    },
    environmentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The environment ID of the deployment',
    },
    deploymentNumber: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'The sequence number of the deployment to stop',
    },
  },

  request: {
    url: '/api/tools/appconfig/stop-deployment',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      applicationId: params.applicationId,
      environmentId: params.environmentId,
      deploymentNumber: params.deploymentNumber,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to stop AppConfig deployment')
    }

    return {
      success: true,
      output: {
        message: data.message ?? '',
        deploymentNumber: data.deploymentNumber ?? null,
        state: data.state ?? null,
      },
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    deploymentNumber: { type: 'number', description: 'Deployment sequence number', optional: true },
    state: { type: 'string', description: 'Deployment state after stopping', optional: true },
  },
}
