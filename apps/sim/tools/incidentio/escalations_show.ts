import type {
  IncidentioEscalationsShowParams,
  IncidentioEscalationsShowResponse,
} from '@/tools/incidentio/types'
import type { ToolConfig } from '@/tools/types'

export const escalationsShowTool: ToolConfig<
  IncidentioEscalationsShowParams,
  IncidentioEscalationsShowResponse
> = {
  id: 'incidentio_escalations_show',
  name: 'Show Escalation',
  description: 'Get details of a specific escalation policy in incident.io',
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
      description: 'The ID of the escalation policy (e.g., "01FCNDV6P870EA6S7TK1DSYDG0")',
    },
  },

  request: {
    url: (params) => `https://api.incident.io/v2/escalations/${params.id}`,
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
        escalation: data.escalation || data,
      },
    }
  },

  outputs: {
    escalation: {
      type: 'object',
      description: 'The escalation policy details',
      properties: {
        id: { type: 'string', description: 'The escalation policy ID' },
        name: { type: 'string', description: 'The escalation policy name' },
        created_at: { type: 'string', description: 'When the escalation policy was created' },
        updated_at: { type: 'string', description: 'When the escalation policy was last updated' },
      },
    },
  },
}
