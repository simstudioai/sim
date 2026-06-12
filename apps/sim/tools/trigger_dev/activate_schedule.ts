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

export const triggerDevActivateScheduleTool: ToolConfig<
  TriggerDevScheduleIdParams,
  TriggerDevScheduleResponse
> = {
  id: 'trigger_dev_activate_schedule',
  name: 'Trigger.dev Activate Schedule',
  description: 'Activate an imperative Trigger.dev schedule so it resumes triggering its task.',
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
      description: 'ID of the schedule to activate (starts with sched_)',
    },
  },

  request: {
    url: (params) =>
      `${TRIGGER_DEV_API_BASE}/api/v1/schedules/${encodeURIComponent(params.scheduleId.trim())}/activate`,
    method: 'POST',
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
