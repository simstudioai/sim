import type {
  TemporalListSchedulesParams,
  TemporalListSchedulesResponse,
} from '@/tools/temporal/types'
import {
  parseTemporalResponse,
  temporalNamespaceUrl,
  temporalRequestHeaders,
} from '@/tools/temporal/utils'
import type { ToolConfig } from '@/tools/types'

interface RawScheduleListEntry {
  scheduleId?: string
  info?: {
    workflowType?: { name?: string }
    notes?: string
    paused?: boolean
    futureActionTimes?: string[]
  }
}

export const listSchedulesTool: ToolConfig<
  TemporalListSchedulesParams,
  TemporalListSchedulesResponse
> = {
  id: 'temporal_list_schedules',
  name: 'Temporal List Schedules',
  description: 'List schedules in a Temporal namespace.',
  version: '1.0.0',

  params: {
    serverUrl: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: "Base URL of the Temporal server's HTTP API (e.g., http://localhost:7243)",
    },
    namespace: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Temporal namespace (e.g., default)',
    },
    apiKey: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'API key sent as a Bearer token (leave blank for servers without auth)',
    },
    query: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Visibility filter over schedules, e.g. TemporalSchedulePaused = false (empty lists all schedules)',
    },
    maximumPageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of schedules to return per page',
    },
    nextPageToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page token from a previous response, for pagination',
    },
  },

  request: {
    url: (params) => {
      const search = new URLSearchParams()
      if (params.query) search.set('query', params.query)
      const pageSize = Number(params.maximumPageSize)
      if (Number.isFinite(pageSize) && pageSize > 0) {
        search.set('maximumPageSize', String(pageSize))
      }
      if (params.nextPageToken) search.set('nextPageToken', params.nextPageToken)
      const queryString = search.toString()
      return `${temporalNamespaceUrl(params.serverUrl, params.namespace)}/schedules${queryString ? `?${queryString}` : ''}`
    },
    method: 'GET',
    headers: (params) => temporalRequestHeaders(params),
  },

  transformResponse: async (response: Response) => {
    const data = await parseTemporalResponse<{
      schedules?: RawScheduleListEntry[]
      nextPageToken?: string
    }>(response, 'list schedules')

    return {
      success: true,
      output: {
        schedules: (data.schedules ?? []).map((schedule) => ({
          scheduleId: schedule.scheduleId ?? null,
          workflowType: schedule.info?.workflowType?.name ?? null,
          paused: schedule.info?.paused ?? false,
          notes: schedule.info?.notes ?? null,
          futureActionTimes: schedule.info?.futureActionTimes ?? [],
        })),
        nextPageToken: data.nextPageToken || null,
      },
    }
  },

  outputs: {
    schedules: {
      type: 'array',
      description: 'Schedules in the namespace',
      items: {
        type: 'object',
        properties: {
          scheduleId: { type: 'string', description: 'Schedule ID' },
          workflowType: {
            type: 'string',
            description: 'Workflow type the schedule starts',
          },
          paused: { type: 'boolean', description: 'Whether the schedule is paused' },
          notes: { type: 'string', description: 'Human-readable notes on the schedule' },
          futureActionTimes: {
            type: 'json',
            description: 'Upcoming action times (RFC 3339)',
          },
        },
      },
    },
    nextPageToken: {
      type: 'string',
      description: 'Token for the next page of results, null when no more pages exist',
      optional: true,
    },
  },
}
