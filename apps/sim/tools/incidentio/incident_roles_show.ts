import type {
  IncidentioIncidentRolesShowParams,
  IncidentioIncidentRolesShowResponse,
} from '@/tools/incidentio/types'
import type { ToolConfig } from '@/tools/types'

export const incidentRolesShowTool: ToolConfig<
  IncidentioIncidentRolesShowParams,
  IncidentioIncidentRolesShowResponse
> = {
  id: 'incidentio_incident_roles_show',
  name: 'Show Incident Role',
  description: 'Get details of a specific incident role in incident.io',
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
      description: 'The ID of the incident role (e.g., "01FCNDV6P870EA6S7TK1DSYDG0")',
    },
  },

  request: {
    url: (params) => `https://api.incident.io/v2/incident_roles/${params.id}`,
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
        incident_role: data.incident_role || data,
      },
    }
  },

  outputs: {
    incident_role: {
      type: 'object',
      description: 'The incident role details',
      properties: {
        id: { type: 'string', description: 'The incident role ID' },
        name: { type: 'string', description: 'The incident role name' },
        description: {
          type: 'string',
          description: 'The incident role description',
          optional: true,
        },
        instructions: {
          type: 'string',
          description: 'Instructions for the role',
        },
        shortform: {
          type: 'string',
          description: 'Short form abbreviation of the role',
        },
        role_type: { type: 'string', description: 'The type of role' },
        required: { type: 'boolean', description: 'Whether the role is required' },
        created_at: { type: 'string', description: 'When the role was created' },
        updated_at: { type: 'string', description: 'When the role was last updated' },
      },
    },
  },
}
