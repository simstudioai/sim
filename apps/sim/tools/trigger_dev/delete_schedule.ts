import type {
  TriggerDevDeleteScheduleResponse,
  TriggerDevScheduleIdParams,
} from '@/tools/trigger_dev/types'
import { buildTriggerDevHeaders, TRIGGER_DEV_API_BASE } from '@/tools/trigger_dev/utils'
import type { ToolConfig } from '@/tools/types'

export const triggerDevDeleteScheduleTool: ToolConfig<
  TriggerDevScheduleIdParams,
  TriggerDevDeleteScheduleResponse
> = {
  id: 'trigger_dev_delete_schedule',
  name: 'Trigger.dev Delete Schedule',
  description: 'Delete an imperative Trigger.dev schedule by its ID.',
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
      description: 'ID of the schedule to delete (starts with sched_)',
    },
  },

  request: {
    url: (params) =>
      `${TRIGGER_DEV_API_BASE}/api/v1/schedules/${encodeURIComponent(params.scheduleId.trim())}`,
    method: 'DELETE',
    headers: (params) => buildTriggerDevHeaders(params.apiKey),
  },

  transformResponse: async (response, params) => {
    const text = await response.text()
    let deleted = response.ok
    if (text) {
      try {
        const data = JSON.parse(text)
        if (typeof data.success === 'boolean') deleted = data.success
      } catch {
        deleted = response.ok
      }
    }
    return {
      success: deleted,
      output: {
        deleted,
        scheduleId: params?.scheduleId ?? '',
      },
    }
  },

  outputs: {
    deleted: { type: 'boolean', description: 'Whether the schedule was deleted' },
    scheduleId: { type: 'string', description: 'ID of the schedule that was deleted' },
  },
}
