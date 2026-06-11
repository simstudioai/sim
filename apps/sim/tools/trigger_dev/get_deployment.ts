import type {
  TriggerDevDeploymentResponse,
  TriggerDevGetDeploymentParams,
} from '@/tools/trigger_dev/types'
import {
  buildTriggerDevHeaders,
  mapTriggerDevDeployment,
  TRIGGER_DEV_API_BASE,
  TRIGGER_DEV_DEPLOYMENT_PROPERTIES,
} from '@/tools/trigger_dev/utils'
import type { ToolConfig } from '@/tools/types'

export const triggerDevGetDeploymentTool: ToolConfig<
  TriggerDevGetDeploymentParams,
  TriggerDevDeploymentResponse
> = {
  id: 'trigger_dev_get_deployment',
  name: 'Trigger.dev Get Deployment',
  description:
    'Retrieve a Trigger.dev deployment by its ID, including its status, version, and registered tasks.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Trigger.dev secret API key (starts with tr_)',
    },
    deploymentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the deployment to retrieve',
    },
  },

  request: {
    url: (params) =>
      `${TRIGGER_DEV_API_BASE}/api/v1/deployments/${encodeURIComponent(params.deploymentId.trim())}`,
    method: 'GET',
    headers: (params) => buildTriggerDevHeaders(params.apiKey),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return {
      success: true,
      output: mapTriggerDevDeployment(data),
    }
  },

  outputs: TRIGGER_DEV_DEPLOYMENT_PROPERTIES,
}
