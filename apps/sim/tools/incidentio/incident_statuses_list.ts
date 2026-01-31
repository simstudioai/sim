import type {
  IncidentioIncidentStatusesListParams,
  IncidentioIncidentStatusesListResponse,
} from '@/tools/incidentio/types'
import type { ToolConfig } from '@/tools/types'

export const incidentStatusesListTool: ToolConfig<
  IncidentioIncidentStatusesListParams,
  IncidentioIncidentStatusesListResponse
> = {
  id: 'incidentio_incident_statuses_list',
  name: 'Incident.io Incident Statuses List',
  description:
    'List all incident statuses configured in your Incident.io workspace. Returns status details including id, name, description, and category.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Incident.io API Key',
    },
  },

  request: {
    url: 'https://api.incident.io/v1/incident_statuses',
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
        incident_statuses: data.incident_statuses.map((status: any) => ({
          id: status.id,
          name: status.name,
          description: status.description,
          category: status.category,
        })),
      },
    }
  },

  outputs: {
    incident_statuses: {
      type: 'array',
      description: 'List of incident statuses',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Unique identifier for the incident status' },
          name: { type: 'string', description: 'Name of the incident status' },
          description: { type: 'string', description: 'Description of the incident status' },
          category: { type: 'string', description: 'Category of the incident status' },
        },
      },
    },
  },
}
