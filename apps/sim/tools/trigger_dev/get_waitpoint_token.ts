import type {
  TriggerDevWaitpointIdParams,
  TriggerDevWaitpointTokenResponse,
} from '@/tools/trigger_dev/types'
import {
  buildTriggerDevHeaders,
  mapTriggerDevWaitpointToken,
  TRIGGER_DEV_API_BASE,
  TRIGGER_DEV_WAITPOINT_TOKEN_PROPERTIES,
} from '@/tools/trigger_dev/utils'
import type { ToolConfig } from '@/tools/types'

export const triggerDevGetWaitpointTokenTool: ToolConfig<
  TriggerDevWaitpointIdParams,
  TriggerDevWaitpointTokenResponse
> = {
  id: 'trigger_dev_get_waitpoint_token',
  name: 'Trigger.dev Get Waitpoint Token',
  description:
    'Retrieve a Trigger.dev waitpoint token by its ID, including its status, timeout, and completion data.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Trigger.dev secret API key (starts with tr_)',
    },
    waitpointId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the waitpoint token to retrieve (starts with waitpoint_)',
    },
  },

  request: {
    url: (params) =>
      `${TRIGGER_DEV_API_BASE}/api/v1/waitpoints/tokens/${encodeURIComponent(params.waitpointId.trim())}`,
    method: 'GET',
    headers: (params) => buildTriggerDevHeaders(params.apiKey),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return {
      success: true,
      output: mapTriggerDevWaitpointToken(data),
    }
  },

  outputs: TRIGGER_DEV_WAITPOINT_TOKEN_PROPERTIES,
}
