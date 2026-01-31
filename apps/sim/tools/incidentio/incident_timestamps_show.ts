import type {
  IncidentioIncidentTimestampsShowParams,
  IncidentioIncidentTimestampsShowResponse,
} from '@/tools/incidentio/types'
import type { ToolConfig } from '@/tools/types'

export const incidentTimestampsShowTool: ToolConfig<
  IncidentioIncidentTimestampsShowParams,
  IncidentioIncidentTimestampsShowResponse
> = {
  id: 'incidentio_incident_timestamps_show',
  name: 'Show Incident Timestamp',
  description: 'Get details of a specific incident timestamp definition in incident.io',
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
      description: 'The ID of the incident timestamp (e.g., "01FCNDV6P870EA6S7TK1DSYDG0")',
    },
  },

  request: {
    url: (params) => `https://api.incident.io/v2/incident_timestamps/${params.id}`,
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
        incident_timestamp: data.incident_timestamp || data,
      },
    }
  },

  outputs: {
    incident_timestamp: {
      type: 'object',
      description: 'The incident timestamp details',
      properties: {
        id: { type: 'string', description: 'The timestamp ID' },
        name: { type: 'string', description: 'The timestamp name' },
        rank: { type: 'number', description: 'The rank/order of the timestamp' },
        created_at: { type: 'string', description: 'When the timestamp was created' },
        updated_at: { type: 'string', description: 'When the timestamp was last updated' },
      },
    },
  },
}
