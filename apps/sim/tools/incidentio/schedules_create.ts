import type {
  IncidentioSchedulesCreateParams,
  IncidentioSchedulesCreateResponse,
} from '@/tools/incidentio/types'
import type { ToolConfig } from '@/tools/types'

export const schedulesCreateTool: ToolConfig<
  IncidentioSchedulesCreateParams,
  IncidentioSchedulesCreateResponse
> = {
  id: 'incidentio_schedules_create',
  name: 'Create Schedule',
  description: 'Create a new schedule in incident.io',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'incident.io API Key',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the schedule (e.g., "Primary On-Call")',
    },
    timezone: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Timezone for the schedule (e.g., America/New_York)',
    },
    config: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Schedule configuration as JSON string with rotations. Example: {"rotations": [{"name": "Primary", "users": [{"id": "user_id"}], "handover_start_at": "2024-01-01T09:00:00Z", "handovers": [{"interval": 1, "interval_type": "weekly"}]}]}',
    },
  },

  request: {
    url: 'https://api.incident.io/v2/schedules',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
    body: (params) => ({
      schedule: {
        name: params.name,
        timezone: params.timezone,
        config: typeof params.config === 'string' ? JSON.parse(params.config) : params.config,
      },
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
      description: 'The created schedule',
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
