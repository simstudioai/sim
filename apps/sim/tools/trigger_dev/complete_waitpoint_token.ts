import type {
  TriggerDevCompleteWaitpointTokenParams,
  TriggerDevCompleteWaitpointTokenResponse,
} from '@/tools/trigger_dev/types'
import {
  buildTriggerDevHeaders,
  parseJsonInput,
  TRIGGER_DEV_API_BASE,
} from '@/tools/trigger_dev/utils'
import type { ToolConfig } from '@/tools/types'

export const triggerDevCompleteWaitpointTokenTool: ToolConfig<
  TriggerDevCompleteWaitpointTokenParams,
  TriggerDevCompleteWaitpointTokenResponse
> = {
  id: 'trigger_dev_complete_waitpoint_token',
  name: 'Trigger.dev Complete Waitpoint Token',
  description:
    'Complete a Trigger.dev waitpoint token, resuming any task waiting on it and passing it optional JSON data.',
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
      description: 'ID of the waitpoint token to complete (starts with waitpoint_)',
    },
    data: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON data passed back to the waiting run as the token result. Example: {"status": "approved"}',
    },
  },

  request: {
    url: (params) =>
      `${TRIGGER_DEV_API_BASE}/api/v1/waitpoints/tokens/${encodeURIComponent(params.waitpointId.trim())}/complete`,
    method: 'POST',
    headers: (params) => buildTriggerDevHeaders(params.apiKey),
    body: (params) => {
      const data = parseJsonInput(params.data, 'data')
      return data === undefined ? {} : { data }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        success: data.success ?? true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the waitpoint token was completed' },
  },
}
