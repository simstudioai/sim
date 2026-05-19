import type {
  IncidentioScheduleEntriesListParams,
  IncidentioScheduleEntriesListResponse,
} from '@/tools/incidentio/types'
import type { ToolConfig } from '@/tools/types'

export const scheduleEntriesListTool: ToolConfig<
  IncidentioScheduleEntriesListParams,
  IncidentioScheduleEntriesListResponse
> = {
  id: 'incidentio_schedule_entries_list',
  name: 'List Schedule Entries',
  description: 'List all entries for a specific schedule in incident.io',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'incident.io API Key',
    },
    schedule_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the schedule to get entries for (e.g., "01FCNDV6P870EA6S7TK1DSYDG0")',
    },
    entry_window_start: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Start date/time to filter entries in ISO 8601 format (e.g., "2024-01-15T09:00:00Z")',
    },
    entry_window_end: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'End date/time to filter entries in ISO 8601 format (e.g., "2024-01-22T09:00:00Z")',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://api.incident.io/v2/schedule_entries')

      url.searchParams.set('schedule_id', params.schedule_id.trim())

      if (params.entry_window_start) {
        url.searchParams.set('entry_window_start', params.entry_window_start)
      }

      if (params.entry_window_end) {
        url.searchParams.set('entry_window_end', params.entry_window_end)
      }

      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        schedule_entries: {
          final: data.schedule_entries?.final ?? [],
          overrides: data.schedule_entries?.overrides ?? [],
          scheduled: data.schedule_entries?.scheduled ?? [],
        },
        pagination_meta: data.pagination_meta,
      },
    }
  },

  outputs: {
    schedule_entries: {
      type: 'object',
      description: 'Schedule entries grouped by final, overrides, and scheduled entries',
      properties: {
        final: { type: 'array', description: 'Final computed schedule entries' },
        overrides: { type: 'array', description: 'Override schedule entries' },
        scheduled: { type: 'array', description: 'Scheduled entries before overrides are applied' },
      },
    },
    pagination_meta: {
      type: 'object',
      description: 'Pagination information',
      optional: true,
      properties: {
        after: { type: 'string', description: 'Cursor for next page', optional: true },
        after_url: { type: 'string', description: 'URL for next page', optional: true },
      },
    },
  },
}
