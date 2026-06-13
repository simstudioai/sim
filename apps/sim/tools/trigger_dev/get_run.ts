import type { TriggerDevRunIdParams, TriggerDevRunResponse } from '@/tools/trigger_dev/types'
import {
  buildTriggerDevHeaders,
  mapTriggerDevRunDetail,
  TRIGGER_DEV_API_BASE,
  TRIGGER_DEV_RUN_DETAIL_OUTPUTS,
} from '@/tools/trigger_dev/utils'
import type { ToolConfig } from '@/tools/types'

export const triggerDevGetRunTool: ToolConfig<TriggerDevRunIdParams, TriggerDevRunResponse> = {
  id: 'trigger_dev_get_run',
  name: 'Trigger.dev Get Run',
  description:
    'Retrieve a Trigger.dev run by its ID, including status, payload, output, attempts, and timing details.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Trigger.dev secret API key (starts with tr_)',
    },
    runId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the run to retrieve (starts with run_)',
    },
  },

  request: {
    url: (params) =>
      `${TRIGGER_DEV_API_BASE}/api/v3/runs/${encodeURIComponent(params.runId.trim())}`,
    method: 'GET',
    headers: (params) => buildTriggerDevHeaders(params.apiKey),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return {
      success: true,
      output: mapTriggerDevRunDetail(data),
    }
  },

  outputs: TRIGGER_DEV_RUN_DETAIL_OUTPUTS,
}
