import type {
  IncidentioEscalationsListParams,
  IncidentioEscalationsListResponse,
} from '@/tools/incidentio/types'
import type { ToolConfig } from '@/tools/types'

export const escalationsListTool: ToolConfig<
  IncidentioEscalationsListParams,
  IncidentioEscalationsListResponse
> = {
  id: 'incidentio_escalations_list',
  name: 'List Escalations',
  description: 'List all escalation policies in incident.io',
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
    url: () => 'https://api.incident.io/v2/escalations',
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
        escalations: data.escalations || [],
      },
    }
  },

  outputs: {
    escalations: {
      type: 'array',
      description: 'List of escalation policies',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'The escalation policy ID' },
          name: { type: 'string', description: 'The escalation policy name' },
          created_at: { type: 'string', description: 'When the escalation policy was created' },
          updated_at: {
            type: 'string',
            description: 'When the escalation policy was last updated',
          },
        },
      },
    },
  },
}
