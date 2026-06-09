import type {
  AppConfigDeploymentRefParams,
  AppConfigDeploymentResponse,
} from '@/tools/appconfig/types'
import type { ToolConfig } from '@/tools/types'

export const stopDeploymentTool: ToolConfig<
  AppConfigDeploymentRefParams,
  AppConfigDeploymentResponse
> = {
  id: 'appconfig_stop_deployment',
  name: 'AppConfig Stop Deployment',
  description: 'Stop a running AppConfig deployment',
  version: '1.0.0',

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
      description: 'The AppConfig application ID',
    },
    environmentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The environment ID',
    },
    deploymentNumber: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'The deployment sequence number',
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
      throw new Error(data.error || 'AppConfig stop deployment failed')
    }
    return { success: true, output: data }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    applicationId: { type: 'string', description: 'The application ID', optional: true },
    environmentId: { type: 'string', description: 'The environment ID', optional: true },
    deploymentNumber: {
      type: 'number',
      description: 'The deployment sequence number',
      optional: true,
    },
    deploymentStrategyId: {
      type: 'string',
      description: 'The deployment strategy ID',
      optional: true,
    },
    configurationProfileId: {
      type: 'string',
      description: 'The configuration profile ID',
      optional: true,
    },
    configurationVersion: {
      type: 'string',
      description: 'The deployed configuration version',
      optional: true,
    },
    description: { type: 'string', description: 'The deployment description', optional: true },
    state: { type: 'string', description: 'The deployment state', optional: true },
    percentageComplete: {
      type: 'number',
      description: 'Percentage of targets deployed',
      optional: true,
    },
    startedAt: { type: 'string', description: 'When the deployment started (ISO)', optional: true },
    completedAt: {
      type: 'string',
      description: 'When the deployment completed (ISO)',
      optional: true,
    },
  },
}
