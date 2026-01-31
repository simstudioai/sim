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
    idempotency_key: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Unique identifier to prevent duplicate escalation creation. Use a UUID or unique string.',
    },
    title: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Title of the escalation (e.g., "Database Critical Alert")',
    },
    escalation_path_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ID of the escalation path to use (required if user_ids not provided)',
    },
    user_ids: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated list of user IDs to notify (required if escalation_path_id not provided)',
    },
  },

  request: {
    url: 'https://api.incident.io/v2/escalations',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
    body: (params) => {
      const body: Record<string, any> = {
        idempotency_key: params.idempotency_key,
        title: params.title,
      }

      if (params.escalation_path_id) {
        body.escalation_path_id = params.escalation_path_id
      }

      if (params.user_ids) {
        body.user_ids = params.user_ids.split(',').map((id: string) => id.trim())
      }

      return body
    },
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
