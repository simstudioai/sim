import type {
  AppConfigDeploymentResponse,
  AppConfigStartDeploymentParams,
} from '@/tools/appconfig/types'
import type { ToolConfig } from '@/tools/types'

export const startDeploymentTool: ToolConfig<
  AppConfigStartDeploymentParams,
  AppConfigDeploymentResponse
> = {
  id: 'appconfig_start_deployment',
  name: 'AppConfig Start Deployment',
  description: 'Deploy a configuration version to an AppConfig environment',
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
      description: 'The environment ID to deploy to',
    },
    deploymentStrategyId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The deployment strategy ID',
    },
    configurationProfileId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The configuration profile ID',
    },
    configurationVersion: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The configuration version number or label to deploy',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'A description of the deployment',
    },
  },

  request: {
    url: '/api/tools/appconfig/start-deployment',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      applicationId: params.applicationId,
      environmentId: params.environmentId,
      deploymentStrategyId: params.deploymentStrategyId,
      configurationProfileId: params.configurationProfileId,
      configurationVersion: params.configurationVersion,
      ...(params.description !== undefined && { description: params.description }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.error || 'AppConfig start deployment failed')
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
