import type {
  TriggerDevRescheduleRunParams,
  TriggerDevRunResponse,
} from '@/tools/trigger_dev/types'
import {
  buildTriggerDevHeaders,
  mapTriggerDevRunDetail,
  TRIGGER_DEV_API_BASE,
  TRIGGER_DEV_RUN_DETAIL_OUTPUTS,
} from '@/tools/trigger_dev/utils'
import type { ToolConfig } from '@/tools/types'

export const triggerDevRescheduleRunTool: ToolConfig<
  TriggerDevRescheduleRunParams,
  TriggerDevRunResponse
> = {
  id: 'trigger_dev_reschedule_run',
  name: 'Trigger.dev Reschedule Run',
  description:
    'Reschedule a delayed Trigger.dev run with a new delay. Only valid while the run is in the DELAYED state.',
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
      description: 'ID of the delayed run to reschedule (starts with run_)',
    },
    delay: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'New delay for the run, as a duration ("30m", "1h", "2d") or an ISO 8601 date to delay until',
    },
  },

  request: {
    url: (params) =>
      `${TRIGGER_DEV_API_BASE}/api/v1/runs/${encodeURIComponent(params.runId.trim())}/reschedule`,
    method: 'POST',
    headers: (params) => buildTriggerDevHeaders(params.apiKey),
    body: (params) => ({ delay: params.delay }),
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
