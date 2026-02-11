import type {
  IncidentioIncidentTypesListParams,
  IncidentioIncidentTypesListResponse,
} from '@/tools/incidentio/types'
import type { ToolConfig } from '@/tools/types'

export const incidentTypesListTool: ToolConfig<
  IncidentioIncidentTypesListParams,
  IncidentioIncidentTypesListResponse
> = {
  id: 'incidentio_incident_types_list',
  name: 'Incident.io Incident Types List',
  description:
    'List all incident types configured in your Incident.io workspace. Returns type details including id, name, description, and default flag.',
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
    url: 'https://api.incident.io/v1/incident_types',
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
        incident_types: data.incident_types.map((type: any) => ({
          id: type.id,
          name: type.name,
          description: type.description,
          is_default: type.is_default,
        })),
      },
    }
  },

  outputs: {
    incident_types: {
      type: 'array',
      description: 'List of incident types',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Unique identifier for the incident type' },
          name: { type: 'string', description: 'Name of the incident type' },
          description: { type: 'string', description: 'Description of the incident type' },
          is_default: {
            type: 'boolean',
            description: 'Whether this is the default incident type',
          },
        },
      },
    },
  },
}
