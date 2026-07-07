import type {
  PagerDutyListSchedulesParams,
  PagerDutyListSchedulesResponse,
} from '@/tools/pagerduty/types'
import type { ToolConfig } from '@/tools/types'

export const listSchedulesTool: ToolConfig<
  PagerDutyListSchedulesParams,
  PagerDutyListSchedulesResponse
> = {
  id: 'pagerduty_list_schedules',
  name: 'PagerDuty List Schedules',
  description: 'List on-call schedules from PagerDuty with an optional name filter.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'PagerDuty REST API Key',
    },
    query: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter schedules by name',
    },
    limit: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of results (max 100)',
    },
    offset: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Offset to start pagination search results',
    },
  },

  request: {
    url: (params) => {
      const query = new URLSearchParams()
      if (params.query) query.set('query', params.query)
      if (params.limit) query.set('limit', params.limit)
      if (params.offset) query.set('offset', params.offset)
      const qs = query.toString()
      return `https://api.pagerduty.com/schedules${qs ? `?${qs}` : ''}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Token token=${params.apiKey}`,
      Accept: 'application/vnd.pagerduty+json;version=2',
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error?.message || `PagerDuty API error: ${response.status}`)
    }

    return {
      success: true,
      output: {
        schedules: (data.schedules ?? []).map((sched: Record<string, unknown>) => ({
          id: sched.id ?? null,
          name: sched.name ?? null,
          description: sched.description ?? null,
          timeZone: sched.time_zone ?? null,
          htmlUrl: sched.html_url ?? null,
        })),
        total: data.total ?? null,
        more: data.more ?? false,
        offset: data.offset ?? 0,
      },
    }
  },

  outputs: {
    schedules: {
      type: 'array',
      description: 'Array of on-call schedules',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Schedule ID' },
          name: { type: 'string', description: 'Schedule name' },
          description: { type: 'string', description: 'Schedule description' },
          timeZone: { type: 'string', description: 'Schedule time zone' },
          htmlUrl: { type: 'string', description: 'PagerDuty web URL' },
        },
      },
    },
    total: {
      type: 'number',
      description:
        'Total number of matching schedules (null unless explicitly requested by PagerDuty)',
      optional: true,
    },
    more: {
      type: 'boolean',
      description: 'Whether more results are available',
    },
    offset: {
      type: 'number',
      description: 'Offset used for this page of results',
    },
  },
}
