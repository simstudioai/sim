import type {
  IncidentioSchedulesShowParams,
  IncidentioSchedulesShowResponse,
} from '@/tools/incidentio/types'
import type { ToolConfig } from '@/tools/types'

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
    url: (params) => `https://api.incident.io/v2/schedules/${params.id}`,
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
      },
    },
  },
}
