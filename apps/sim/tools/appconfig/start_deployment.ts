import type {
  AppConfigStartDeploymentParams,
  AppConfigStartDeploymentResponse,
} from '@/tools/appconfig/types'
import type { ToolConfig } from '@/tools/types'

export const startDeploymentTool: ToolConfig<
  AppConfigStartDeploymentParams,
  AppConfigStartDeploymentResponse
> = {
  id: 'appconfig_start_deployment',
  name: 'AppConfig Start Deployment',
  description: 'Start deploying a configuration version to an AWS AppConfig environment',
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
      description: 'The application ID to deploy in',
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
      description: 'The deployment strategy ID to use',
    },
    configurationProfileId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The configuration profile ID to deploy',
    },
    configurationVersion: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The configuration version to deploy',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Description of the deployment',
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
      description: params.description,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to start AppConfig deployment')
    }

    return {
      success: true,
      output: {
        message: data.message ?? '',
        deploymentNumber: data.deploymentNumber ?? null,
        state: data.state ?? null,
        percentageComplete: data.percentageComplete ?? null,
      },
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    deploymentNumber: {
      type: 'number',
      description: 'Sequence number of the deployment',
      optional: true,
    },
    state: { type: 'string', description: 'Current deployment state', optional: true },
    percentageComplete: {
      type: 'number',
      description: 'Percentage of the deployment that has completed',
      optional: true,
    },
  },
}
