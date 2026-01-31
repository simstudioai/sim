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
    page_size: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results to return per page (e.g., 10, 25, 50)',
    },
    after: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Cursor for pagination (e.g., "01FCNDV6P870EA6S7TK1DSYDG0")',
    },
  },

  request: {
    url: (params) => {
      const queryParams: string[] = []

      queryParams.push(`schedule_id=${params.schedule_id}`)

      if (params.entry_window_start) {
        queryParams.push(`entry_window_start=${encodeURIComponent(params.entry_window_start)}`)
      }

      if (params.entry_window_end) {
        queryParams.push(`entry_window_end=${encodeURIComponent(params.entry_window_end)}`)
      }

      if (params.page_size) {
        queryParams.push(`page_size=${params.page_size}`)
      }

      if (params.after) {
        queryParams.push(`after=${params.after}`)
      }

      const queryString = queryParams.length > 0 ? `?${queryParams.join('&')}` : ''
      return `https://api.incident.io/v2/schedule_entries${queryString}`
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
        schedule_entries: data.schedule_entries || data,
        pagination_meta: data.pagination_meta,
      },
    }
  },

  outputs: {
    schedule_entries: {
      type: 'array',
      description: 'List of schedule entries',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'The entry ID' },
          schedule_id: { type: 'string', description: 'The schedule ID' },
          user: {
            type: 'object',
            description: 'User assigned to this entry',
            properties: {
              id: { type: 'string', description: 'User ID' },
              name: { type: 'string', description: 'User name' },
              email: { type: 'string', description: 'User email' },
            },
          },
          start_at: { type: 'string', description: 'When the entry starts' },
          end_at: { type: 'string', description: 'When the entry ends' },
          layer_id: { type: 'string', description: 'The schedule layer ID' },
          created_at: { type: 'string', description: 'When the entry was created' },
          updated_at: { type: 'string', description: 'When the entry was last updated' },
        },
      },
    },
    pagination_meta: {
      type: 'object',
      description: 'Pagination information',
      optional: true,
      properties: {
        after: { type: 'string', description: 'Cursor for next page', optional: true },
        after_url: { type: 'string', description: 'URL for next page', optional: true },
        page_size: { type: 'number', description: 'Number of results per page' },
      },
    },
  },
}
