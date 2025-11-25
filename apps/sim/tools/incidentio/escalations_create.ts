import type {
  IncidentioEscalationsCreateParams,
  IncidentioEscalationsCreateResponse,
} from '@/tools/incidentio/types'
import type { ToolConfig } from '@/tools/types'

export const escalationsCreateTool: ToolConfig<
  IncidentioEscalationsCreateParams,
  IncidentioEscalationsCreateResponse
> = {
  id: 'incidentio_escalations_create',
  name: 'Create Escalation',
  description: 'Create a new escalation policy in incident.io',
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
      description: 'Name of the escalation policy',
    },
  },

  request: {
    url: 'https://api.incident.io/v2/escalations',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
    body: (params) => ({
      name: params.name,
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
      description: 'The created escalation policy',
      properties: {
        id: { type: 'string', description: 'The escalation policy ID' },
        name: { type: 'string', description: 'The escalation policy name' },
        created_at: { type: 'string', description: 'When the escalation policy was created' },
        updated_at: { type: 'string', description: 'When the escalation policy was last updated' },
      },
    },
  },
}
