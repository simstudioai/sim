import type {
  AppConfigGetDeploymentParams,
  AppConfigGetDeploymentResponse,
} from '@/tools/appconfig/types'
import type { ToolConfig } from '@/tools/types'

export const getDeploymentTool: ToolConfig<
  AppConfigGetDeploymentParams,
  AppConfigGetDeploymentResponse
> = {
  id: 'appconfig_get_deployment',
  name: 'AppConfig Get Deployment',
  description: 'Get details about a specific AWS AppConfig deployment',
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
      description: 'The sequence number of the deployment',
    },
  },

  request: {
    url: '/api/tools/appconfig/get-deployment',
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
      throw new Error(data.error || 'Failed to get AppConfig deployment')
    }

    return {
      success: true,
      output: {
        applicationId: data.applicationId ?? '',
        environmentId: data.environmentId ?? '',
        deploymentStrategyId: data.deploymentStrategyId ?? '',
        configurationProfileId: data.configurationProfileId ?? '',
        deploymentNumber: data.deploymentNumber ?? null,
        configurationName: data.configurationName ?? null,
        configurationVersion: data.configurationVersion ?? null,
        description: data.description ?? null,
        state: data.state ?? null,
        percentageComplete: data.percentageComplete ?? null,
        startedAt: data.startedAt ?? null,
        completedAt: data.completedAt ?? null,
      },
    }
  },

  outputs: {
    applicationId: { type: 'string', description: 'Application ID' },
    environmentId: { type: 'string', description: 'Environment ID' },
    deploymentStrategyId: { type: 'string', description: 'Deployment strategy ID' },
    configurationProfileId: { type: 'string', description: 'Configuration profile ID' },
    deploymentNumber: { type: 'number', description: 'Deployment sequence number', optional: true },
    configurationName: { type: 'string', description: 'Configuration name', optional: true },
    configurationVersion: { type: 'string', description: 'Configuration version', optional: true },
    description: { type: 'string', description: 'Deployment description', optional: true },
    state: { type: 'string', description: 'Current deployment state', optional: true },
    percentageComplete: { type: 'number', description: 'Percentage completed', optional: true },
    startedAt: { type: 'string', description: 'When the deployment started', optional: true },
    completedAt: { type: 'string', description: 'When the deployment completed', optional: true },
  },
}
