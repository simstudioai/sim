import type {
  IncidentioIncidentRolesListParams,
  IncidentioIncidentRolesListResponse,
} from '@/tools/incidentio/types'
import type { ToolConfig } from '@/tools/types'

export const incidentRolesListTool: ToolConfig<
  IncidentioIncidentRolesListParams,
  IncidentioIncidentRolesListResponse
> = {
  id: 'incidentio_incident_roles_list',
  name: 'List Incident Roles',
  description: 'List all incident roles in incident.io',
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
    url: 'https://api.incident.io/v2/incident_roles',
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
        incident_roles: data.incident_roles || data,
      },
    }
  },

  outputs: {
    incident_roles: {
      type: 'array',
      description: 'List of incident roles',
      items: {
        type: 'object',
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
  },
}
