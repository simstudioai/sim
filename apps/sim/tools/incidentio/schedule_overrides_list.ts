import type {
  IncidentioScheduleOverridesListParams,
  IncidentioScheduleOverridesListResponse,
} from '@/tools/incidentio/types'
import type { ToolConfig } from '@/tools/types'

export const scheduleOverridesListTool: ToolConfig<
  IncidentioScheduleOverridesListParams,
  IncidentioScheduleOverridesListResponse
> = {
  id: 'incidentio_schedule_overrides_list',
  name: 'List Schedule Overrides',
  description:
    'List the one-off overrides layered on top of a schedule in incident.io, such as someone covering a colleague’s shift',
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
      description:
        'The ID of the schedule to get overrides for (e.g., "01FCNDV6P870EA6S7TK1DSYDG0")',
    },
    rotation_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return overrides on this rotation',
    },
    layer_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return overrides on this layer',
    },
    page_size: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results per page (e.g., 10, 25, 50)',
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
      const url = new URL('https://api.incident.io/v2/schedule_overrides')
      url.searchParams.set('schedule_id', params.schedule_id.trim())

      if (params.rotation_id) url.searchParams.set('rotation_id', params.rotation_id.trim())
      if (params.layer_id) url.searchParams.set('layer_id', params.layer_id.trim())
      if (params.page_size) url.searchParams.set('page_size', String(params.page_size))
      if (params.after) url.searchParams.set('after', params.after)

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
        overrides: data.overrides ?? [],
        pagination_meta: data.pagination_meta,
      },
    }
  },

  outputs: {
    overrides: {
      type: 'array',
      description: 'List of schedule overrides',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Override ID' },
          schedule_id: { type: 'string', description: 'Schedule the override applies to' },
          rotation_id: { type: 'string', description: 'Rotation the override applies to' },
          layer_id: { type: 'string', description: 'Layer the override applies to' },
          start_at: { type: 'string', description: 'Start of the override' },
          end_at: { type: 'string', description: 'End of the override' },
          created_at: { type: 'string', description: 'When the override was created' },
          updated_at: { type: 'string', description: 'When the override was last updated' },
          user: {
            type: 'object',
            description: 'The user covering the override',
            optional: true,
            properties: {
              id: { type: 'string', description: 'User ID' },
              name: { type: 'string', description: 'User display name' },
              email: { type: 'string', description: 'User email address', optional: true },
              role: { type: 'string', description: 'User role', optional: true },
              slack_user_id: { type: 'string', description: 'Slack user ID', optional: true },
            },
          },
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
