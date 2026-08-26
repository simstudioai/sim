import type {
  IncidentioSchedulesShowParams,
  IncidentioSchedulesShowResponse,
} from '@/tools/incidentio/types'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const schedulesShowTool: ToolConfig<
  IncidentioSchedulesShowParams,
  IncidentioSchedulesShowResponse
> = {
  id: 'incidentio_schedules_show',
  name: 'Show Schedule',
  description: 'Get details of a specific schedule in incident.io',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'incident.io API Key',
    },
    id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the schedule (e.g., "01FCNDV6P870EA6S7TK1DSYDG0")',
    },
  },

  request: {
    url: (params) => `https://api.incident.io/v2/schedules/${safeUrlPathSegment(params.id, 'id')}`,
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
        schedule: data.schedule || data,
      },
    }
  },

  outputs: {
    schedule: {
      type: 'object',
      description: 'The schedule details',
      properties: {
        id: { type: 'string', description: 'The schedule ID' },
        name: { type: 'string', description: 'The schedule name' },
        timezone: { type: 'string', description: 'The schedule timezone' },
        created_at: { type: 'string', description: 'When the schedule was created' },
        updated_at: { type: 'string', description: 'When the schedule was last updated' },
        current_shifts: {
          type: 'array',
          description: 'Shifts that are ongoing right now, naming who is on call',
          optional: true,
          items: {
            type: 'object',
            properties: {
              start_at: { type: 'string', description: 'When the shift starts' },
              end_at: { type: 'string', description: 'When the shift ends' },
              entry_id: { type: 'string', description: 'Schedule entry ID', optional: true },
              rotation_id: { type: 'string', description: 'Rotation ID', optional: true },
              layer_id: { type: 'string', description: 'Layer ID', optional: true },
              user: { type: 'object', description: 'The on-call user', optional: true },
            },
          },
        },
        next_shifts: {
          type: 'array',
          description:
            'Shifts that take over at the next changeover. Only returned when the page size is 25 or lower',
          optional: true,
          items: {
            type: 'object',
            properties: {
              start_at: { type: 'string', description: 'When the shift starts' },
              end_at: { type: 'string', description: 'When the shift ends' },
              entry_id: { type: 'string', description: 'Schedule entry ID', optional: true },
              rotation_id: { type: 'string', description: 'Rotation ID', optional: true },
              layer_id: { type: 'string', description: 'Layer ID', optional: true },
              user: { type: 'object', description: 'The on-call user', optional: true },
            },
          },
        },
        permalink: {
          type: 'string',
          description: 'Link to the schedule in the incident.io dashboard',
          optional: true,
        },
        team_ids: {
          type: 'array',
          description: 'IDs of teams that own this schedule',
          optional: true,
          items: { type: 'string' },
        },
      },
    },
  },
}
