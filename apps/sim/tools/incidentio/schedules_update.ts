import type {
  IncidentioSchedulesUpdateParams,
  IncidentioSchedulesUpdateResponse,
} from '@/tools/incidentio/types'
import type { ToolConfig } from '@/tools/types'

export const schedulesUpdateTool: ToolConfig<
  IncidentioSchedulesUpdateParams,
  IncidentioSchedulesUpdateResponse
> = {
  id: 'incidentio_schedules_update',
  name: 'Update Schedule',
  description: 'Update an existing schedule in incident.io',
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
      description: 'The ID of the schedule to update (e.g., "01FCNDV6P870EA6S7TK1DSYDG0")',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New name for the schedule (e.g., "Primary On-Call")',
    },
    timezone: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New timezone for the schedule (e.g., America/New_York)',
    },
    config: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Schedule configuration as JSON string with rotations. Example: {"rotations": [{"name": "Primary", "users": [{"id": "user_id"}], "handover_start_at": "2024-01-01T09:00:00Z", "handovers": [{"interval": 1, "interval_type": "weekly"}]}]}',
    },
  },

  request: {
    url: (params) => `https://api.incident.io/v2/schedules/${params.id}`,
    method: 'PUT',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
    body: (params) => {
      const schedule: Record<string, any> = {}
      if (params.name) schedule.name = params.name
      if (params.timezone) schedule.timezone = params.timezone
      if (params.config) {
        schedule.config =
          typeof params.config === 'string' ? JSON.parse(params.config) : params.config
      }
      return { schedule }
    },
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
      description: 'The updated schedule',
      properties: {
        id: { type: 'string', description: 'The schedule ID' },
        name: { type: 'string', description: 'The schedule name' },
        timezone: { type: 'string', description: 'The schedule timezone' },
        created_at: { type: 'string', description: 'When the schedule was created' },
        updated_at: { type: 'string', description: 'When the schedule was last updated' },
      },
    },
  },
}
