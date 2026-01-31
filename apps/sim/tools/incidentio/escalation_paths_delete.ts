import type {
  IncidentioEscalationPathsDeleteParams,
  IncidentioEscalationPathsDeleteResponse,
} from '@/tools/incidentio/types'
import type { ToolConfig } from '@/tools/types'

export const escalationPathsDeleteTool: ToolConfig<
  IncidentioEscalationPathsDeleteParams,
  IncidentioEscalationPathsDeleteResponse
> = {
  id: 'incidentio_escalation_paths_delete',
  name: 'Delete Escalation Path',
  description: 'Delete an escalation path in incident.io',
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
      description: 'The ID of the escalation path to delete (e.g., "01FCNDV6P870EA6S7TK1DSYDG0")',
    },
  },

  request: {
    url: (params) => `https://api.incident.io/v2/escalation_paths/${params.id}`,
    method: 'DELETE',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response: Response) => {
    return {
      success: true,
      output: {
        message: 'Escalation path deleted successfully',
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
