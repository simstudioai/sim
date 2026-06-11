import type { TriggerDevRunActionResponse, TriggerDevRunIdParams } from '@/tools/trigger_dev/types'
import { buildTriggerDevHeaders, TRIGGER_DEV_API_BASE } from '@/tools/trigger_dev/utils'
import type { ToolConfig } from '@/tools/types'

export const triggerDevCancelRunTool: ToolConfig<
  TriggerDevRunIdParams,
  TriggerDevRunActionResponse
> = {
  id: 'trigger_dev_cancel_run',
  name: 'Trigger.dev Cancel Run',
  description:
    'Cancel an in-progress Trigger.dev run. Has no effect if the run is already completed.',
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
      description: 'ID of the run to cancel (starts with run_)',
    },
  },

  request: {
    url: (params) =>
      `${TRIGGER_DEV_API_BASE}/api/v2/runs/${encodeURIComponent(params.runId.trim())}/cancel`,
    method: 'POST',
    headers: (params) => buildTriggerDevHeaders(params.apiKey),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        id: data.id,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'ID of the run that was canceled' },
  },
}
