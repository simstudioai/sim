import type {
  IncidentioUsersShowParams,
  IncidentioUsersShowResponse,
} from '@/tools/incidentio/types'
import type { ToolConfig } from '@/tools/types'

export const usersShowTool: ToolConfig<IncidentioUsersShowParams, IncidentioUsersShowResponse> = {
  id: 'incidentio_users_show',
  name: 'Incident.io Users Show',
  description:
    'Get detailed information about a specific user in your Incident.io workspace by their ID.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Incident.io API Key',
    },
    id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The unique identifier of the user to retrieve (e.g., "01FCNDV6P870EA6S7TK1DSYDG0")',
    },
  },

  request: {
    url: (params) => `https://api.incident.io/v2/users/${params.id}`,
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
        user: {
          id: data.user.id,
          name: data.user.name,
          email: data.user.email,
          role: data.user.role,
        },
      },
    }
  },

  outputs: {
    user: {
      type: 'object',
      description: 'Details of the requested user',
      properties: {
        id: { type: 'string', description: 'Unique identifier for the user' },
        name: { type: 'string', description: 'Full name of the user' },
        email: { type: 'string', description: 'Email address of the user' },
        role: { type: 'string', description: 'Role of the user in the workspace' },
      },
    },
  },
}
