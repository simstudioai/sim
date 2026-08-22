import type {
  IncidentioIncidentMembershipsCreateParams,
  IncidentioIncidentMembershipsCreateResponse,
} from '@/tools/incidentio/types'
import type { ToolConfig } from '@/tools/types'

export const incidentMembershipsCreateTool: ToolConfig<
  IncidentioIncidentMembershipsCreateParams,
  IncidentioIncidentMembershipsCreateResponse
> = {
  id: 'incidentio_incident_memberships_create',
  name: 'Grant Incident Membership',
  description: 'Make a user a member of a private incident in incident.io',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'incident.io API Key',
    },
    incident_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the private incident (e.g., "01FCNDV6P870EA6S7TK1DSYD5H")',
    },
    user_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the user to grant access to (e.g., "01FCNDV6P870EA6S7TK1DSYDG0")',
    },
  },

  request: {
    url: 'https://api.incident.io/v1/incident_memberships',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
    body: (params) => ({
      incident_id: params.incident_id.trim(),
      user_id: params.user_id.trim(),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        incident_membership: data.incident_membership,
      },
    }
  },

  outputs: {
    incident_membership: {
      type: 'object',
      description: 'The created incident membership',
      properties: {
        id: { type: 'string', description: 'Incident membership ID' },
        incident_id: { type: 'string', description: 'ID of the incident' },
        created_at: { type: 'string', description: 'When the membership was created' },
        updated_at: { type: 'string', description: 'When the membership was last updated' },
        user: {
          type: 'object',
          description: 'The user who was granted access',
          properties: {
            id: { type: 'string', description: 'User ID' },
            name: { type: 'string', description: 'User display name' },
            email: { type: 'string', description: 'User email address', optional: true },
            role: { type: 'string', description: 'User role', optional: true },
            slack_user_id: { type: 'string', description: 'Slack user ID', optional: true },
          },
        },
      },
    },
  },
}
