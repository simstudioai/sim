import type {
  TriggerDevCreateScheduleParams,
  TriggerDevScheduleResponse,
} from '@/tools/trigger_dev/types'
import {
  buildTriggerDevHeaders,
  mapTriggerDevSchedule,
  TRIGGER_DEV_API_BASE,
  TRIGGER_DEV_SCHEDULE_OUTPUTS,
} from '@/tools/trigger_dev/utils'
import type { ToolConfig } from '@/tools/types'

export const triggerDevCreateScheduleTool: ToolConfig<
  TriggerDevCreateScheduleParams,
  TriggerDevScheduleResponse
> = {
  id: 'trigger_dev_create_schedule',
  name: 'Trigger.dev Create Schedule',
  description:
    'Create an imperative cron schedule that triggers a Trigger.dev task on a recurring basis.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Trigger.dev secret API key (starts with tr_)',
    },
    task: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Identifier of the task to schedule (e.g., "daily-report")',
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
    deduplicationKey: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Key that prevents duplicate schedules; creating again with the same key updates the existing schedule',
    },
  },

  request: {
    url: `${TRIGGER_DEV_API_BASE}/api/v1/schedules`,
    method: 'POST',
    headers: (params) => buildTriggerDevHeaders(params.apiKey),
    body: (params) => {
      const body: Record<string, unknown> = {
        task: params.task,
        cron: params.cron,
        deduplicationKey: params.deduplicationKey,
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
