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
      description: 'Name of the schedule',
    },
    timezone: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Timezone for the schedule (e.g., America/New_York)',
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
      name: params.name,
      timezone: params.timezone,
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
