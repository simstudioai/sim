import type {
  IncidentioSeveritiesListParams,
  IncidentioSeveritiesListResponse,
} from '@/tools/incidentio/types'
import type { ToolConfig } from '@/tools/types'

export const severitiesListTool: ToolConfig<
  IncidentioSeveritiesListParams,
  IncidentioSeveritiesListResponse
> = {
  id: 'incidentio_severities_list',
  name: 'Incident.io Severities List',
  description:
    'List all severity levels configured in your Incident.io workspace. Returns severity details including id, name, description, and rank.',
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
    url: 'https://api.incident.io/v1/severities',
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
        severities: data.severities.map((severity: any) => ({
          id: severity.id,
          name: severity.name,
          description: severity.description,
          rank: severity.rank,
        })),
      },
    }
  },

  outputs: {
    severities: {
      type: 'array',
      description: 'List of severity levels',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Unique identifier for the severity level' },
          name: { type: 'string', description: 'Name of the severity level' },
          description: { type: 'string', description: 'Description of the severity level' },
          rank: { type: 'number', description: 'Rank/order of the severity level' },
        },
      },
    },
  },
}
