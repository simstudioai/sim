import type {
  IncidentioIncidentMembershipsRevokeParams,
  IncidentioIncidentMembershipsRevokeResponse,
} from '@/tools/incidentio/types'
import type { ToolConfig } from '@/tools/types'

export const incidentMembershipsRevokeTool: ToolConfig<
  IncidentioIncidentMembershipsRevokeParams,
  IncidentioIncidentMembershipsRevokeResponse
> = {
  id: 'incidentio_incident_memberships_revoke',
  name: 'Revoke Incident Membership',
  description: "Revoke a user's membership of a private incident in incident.io",
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
      description: 'The ID of the user to revoke access from (e.g., "01FCNDV6P870EA6S7TK1DSYDG0")',
    },
  },

  request: {
    url: 'https://api.incident.io/v1/incident_memberships/actions/revoke',
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

  transformResponse: async () => {
    return {
      success: true,
      output: {
        message: 'Incident membership revoked successfully',
      },
    }
  },

  outputs: {
    message: {
      type: 'string',
      description: 'Success message',
    },
  },
}
