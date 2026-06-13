import type {
  TriggerDevScheduleIdParams,
  TriggerDevScheduleResponse,
} from '@/tools/trigger_dev/types'
import {
  buildTriggerDevHeaders,
  mapTriggerDevSchedule,
  TRIGGER_DEV_API_BASE,
  TRIGGER_DEV_SCHEDULE_OUTPUTS,
} from '@/tools/trigger_dev/utils'
import type { ToolConfig } from '@/tools/types'

export const triggerDevGetScheduleTool: ToolConfig<
  TriggerDevScheduleIdParams,
  TriggerDevScheduleResponse
> = {
  id: 'trigger_dev_get_schedule',
  name: 'Trigger.dev Get Schedule',
  description: 'Retrieve a Trigger.dev schedule by its ID.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Trigger.dev secret API key (starts with tr_)',
    },
    scheduleId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the schedule to retrieve (starts with sched_)',
    },
  },

  request: {
    url: (params) =>
      `${TRIGGER_DEV_API_BASE}/api/v1/schedules/${encodeURIComponent(params.scheduleId.trim())}`,
    method: 'GET',
    headers: (params) => buildTriggerDevHeaders(params.apiKey),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return {
      success: true,
      output: mapTriggerDevSchedule(data),
    }
  },

  outputs: TRIGGER_DEV_SCHEDULE_OUTPUTS,
}
