import type {
  TriggerDevListTimezonesParams,
  TriggerDevListTimezonesResponse,
} from '@/tools/trigger_dev/types'
import { buildTriggerDevHeaders, TRIGGER_DEV_API_BASE } from '@/tools/trigger_dev/utils'
import type { ToolConfig } from '@/tools/types'

export const triggerDevListTimezonesTool: ToolConfig<
  TriggerDevListTimezonesParams,
  TriggerDevListTimezonesResponse
> = {
  id: 'trigger_dev_list_timezones',
  name: 'Trigger.dev List Timezones',
  description:
    'List the IANA timezones supported by Trigger.dev schedules, for use as the timezone of a cron schedule.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Trigger.dev secret API key (starts with tr_)',
    },
    excludeUtc: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Set to "true" to exclude UTC from the returned timezones',
    },
  },

  request: {
    url: (params) =>
      params.excludeUtc === 'true'
        ? `${TRIGGER_DEV_API_BASE}/api/v1/timezones?excludeUtc=true`
        : `${TRIGGER_DEV_API_BASE}/api/v1/timezones`,
    method: 'GET',
    headers: (params) => buildTriggerDevHeaders(params.apiKey),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        timezones: data.timezones ?? [],
      },
    }
  },

  outputs: {
    timezones: {
      type: 'array',
      description: 'IANA timezones supported by schedules',
      items: { type: 'string', description: 'IANA timezone name' },
    },
  },
}
