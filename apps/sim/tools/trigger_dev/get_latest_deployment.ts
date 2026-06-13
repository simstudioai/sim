import type { TriggerDevBaseParams, TriggerDevDeploymentResponse } from '@/tools/trigger_dev/types'
import {
  buildTriggerDevHeaders,
  mapTriggerDevDeployment,
  TRIGGER_DEV_API_BASE,
  TRIGGER_DEV_DEPLOYMENT_PROPERTIES,
} from '@/tools/trigger_dev/utils'
import type { ToolConfig } from '@/tools/types'

export const triggerDevGetLatestDeploymentTool: ToolConfig<
  TriggerDevBaseParams,
  TriggerDevDeploymentResponse
> = {
  id: 'trigger_dev_get_latest_deployment',
  name: 'Trigger.dev Get Latest Deployment',
  description: 'Retrieve the latest Trigger.dev deployment in the environment of the API key.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Trigger.dev secret API key (starts with tr_)',
    },
  },

  request: {
    url: `${TRIGGER_DEV_API_BASE}/api/v1/deployments/latest`,
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
