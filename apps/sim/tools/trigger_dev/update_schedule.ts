import type {
  TriggerDevScheduleResponse,
  TriggerDevUpdateScheduleParams,
} from '@/tools/trigger_dev/types'
import {
  buildTriggerDevHeaders,
  mapTriggerDevSchedule,
  TRIGGER_DEV_API_BASE,
  TRIGGER_DEV_SCHEDULE_OUTPUTS,
} from '@/tools/trigger_dev/utils'
import type { ToolConfig } from '@/tools/types'

export const triggerDevUpdateScheduleTool: ToolConfig<
  TriggerDevUpdateScheduleParams,
  TriggerDevScheduleResponse
> = {
  id: 'trigger_dev_update_schedule',
  name: 'Trigger.dev Update Schedule',
  description:
    'Update an imperative Trigger.dev schedule by its ID, replacing its task, cron expression, timezone, and external ID.',
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
      description: 'ID of the schedule to update (starts with sched_)',
    },
    task: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Identifier of the task the schedule triggers (e.g., "daily-report")',
    },
    cron: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Cron expression defining when the task runs (e.g., "0 0 * * *")',
    },
    timezone: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'IANA timezone the cron expression is evaluated in (e.g., "America/New_York"). Defaults to UTC',
    },
    externalId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'External identifier to associate with the schedule (e.g., a user ID)',
    },
  },

  request: {
    url: (params) =>
      `${TRIGGER_DEV_API_BASE}/api/v1/schedules/${encodeURIComponent(params.scheduleId.trim())}`,
    method: 'PUT',
    headers: (params) => buildTriggerDevHeaders(params.apiKey),
    body: (params) => {
      const body: Record<string, unknown> = {
        task: params.task,
        cron: params.cron,
      }
      if (params.timezone) body.timezone = params.timezone
      if (params.externalId) body.externalId = params.externalId
      return body
    },
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
