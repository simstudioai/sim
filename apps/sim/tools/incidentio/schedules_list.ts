import type {
  IncidentioSchedulesListParams,
  IncidentioSchedulesListResponse,
} from '@/tools/incidentio/types'
import type { ToolConfig } from '@/tools/types'

export const schedulesListTool: ToolConfig<
  IncidentioSchedulesListParams,
  IncidentioSchedulesListResponse
> = {
  id: 'incidentio_schedules_list',
  name: 'List Schedules',
  description: 'List all schedules in incident.io',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'incident.io API Key',
    },
    page_size: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results per page (e.g., 10, 25, 50). Default: 25',
    },
    after: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Pagination cursor to fetch the next page of results (e.g., "01FCNDV6P870EA6S7TK1DSYDG0")',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://api.incident.io/v2/schedules')
      if (params.page_size) {
        url.searchParams.append('page_size', params.page_size.toString())
      }
      if (params.after) {
        url.searchParams.append('after', params.after)
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
        schedules: data.schedules || [],
        pagination_meta: data.pagination_meta
          ? {
              after: data.pagination_meta.after,
              page_size: data.pagination_meta.page_size,
            }
          : undefined,
      },
    }
  },

  outputs: {
    schedules: {
      type: 'array',
      description: 'List of schedules',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'The schedule ID' },
          name: { type: 'string', description: 'The schedule name' },
          timezone: { type: 'string', description: 'The schedule timezone' },
          created_at: { type: 'string', description: 'When the schedule was created' },
          updated_at: { type: 'string', description: 'When the schedule was last updated' },
        },
      },
    },
    pagination_meta: {
      type: 'object',
      description: 'Pagination metadata',
      optional: true,
      properties: {
        after: { type: 'string', description: 'Cursor for next page', optional: true },
        page_size: { type: 'number', description: 'Number of results per page' },
      },
    },
  },
}
