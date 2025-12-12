import type {
  IncidentioIncidentTimestampsListParams,
  IncidentioIncidentTimestampsListResponse,
} from '@/tools/incidentio/types'
import type { ToolConfig } from '@/tools/types'

export const incidentTimestampsListTool: ToolConfig<
  IncidentioIncidentTimestampsListParams,
  IncidentioIncidentTimestampsListResponse
> = {
  id: 'incidentio_incident_timestamps_list',
  name: 'List Incident Timestamps',
  description: 'List all incident timestamp definitions in incident.io',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'incident.io API Key',
    },
  },

  request: {
    url: 'https://api.incident.io/v2/incident_timestamps',
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
        incident_timestamps: data.incident_timestamps || data,
      },
    }
  },

  outputs: {
    incident_timestamps: {
      type: 'array',
      description: 'List of incident timestamp definitions',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'The timestamp ID' },
          name: { type: 'string', description: 'The timestamp name' },
          rank: { type: 'number', description: 'The rank/order of the timestamp' },
          created_at: { type: 'string', description: 'When the timestamp was created' },
          updated_at: { type: 'string', description: 'When the timestamp was last updated' },
        },
      },
    },
  },
}
