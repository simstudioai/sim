import type {
  IncidentioIncidentRolesCreateParams,
  IncidentioIncidentRolesCreateResponse,
} from '@/tools/incidentio/types'
import type { ToolConfig } from '@/tools/types'

export const incidentRolesCreateTool: ToolConfig<
  IncidentioIncidentRolesCreateParams,
  IncidentioIncidentRolesCreateResponse
> = {
  id: 'incidentio_incident_roles_create',
  name: 'Create Incident Role',
  description: 'Create a new incident role in incident.io',
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
      description: 'Name of the incident role (e.g., "Incident Commander")',
    },
    description: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Description of the incident role',
    },
    instructions: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Instructions for the incident role',
    },
    shortform: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Short form abbreviation for the role',
    },
  },

  request: {
    url: 'https://api.incident.io/v2/incident_roles',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
    body: (params) => ({
      name: params.name,
      description: params.description,
      instructions: params.instructions,
      shortform: params.shortform,
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
      description: 'The created incident role',
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
