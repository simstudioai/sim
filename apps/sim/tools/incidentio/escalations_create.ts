import type {
  IncidentioEscalationsCreateParams,
  IncidentioEscalationsCreateResponse,
} from '@/tools/incidentio/types'
import { parseIncidentioList } from '@/tools/incidentio/utils'
import { INCIDENTIO_CREDENTIAL_OAUTH } from '@/tools/shared/saved-credentials'
import type { ToolConfig } from '@/tools/types'

export const escalationsCreateTool: ToolConfig<
  IncidentioEscalationsCreateParams,
  IncidentioEscalationsCreateResponse
> = {
  id: 'incidentio_escalations_create',
  name: 'Create Escalation',
  description:
    'Page users or an escalation path (create an escalation) in incident.io. Provide either escalation_path_id or user_ids, not both. To create a reusable escalation policy, use Create Escalation Path instead.',
  version: '1.0.0',
  oauth: INCIDENTIO_CREDENTIAL_OAUTH,

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
        'Comma-separated list of user IDs to page directly (required if escalation_path_id not provided)',
    },
    incident_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'ID of an incident to link this escalation to; it appears in the escalation\'s related incidents (e.g., "01H0J1EXE7AXZ2C93K61WBPYEH")',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Additional details included with the page (e.g., "Database CPU above 90%")',
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
      const body: Record<string, unknown> = {
        idempotency_key: params.idempotency_key,
        title: params.title,
      }

      if (params.escalation_path_id) {
        body.escalation_path_id = params.escalation_path_id
      }

      if (params.user_ids) {
        body.user_ids = parseIncidentioList(params.user_ids)
      }

      const incidentId = params.incident_id?.trim()
      if (incidentId) body.incident_id = incidentId
      if (params.description) body.description = params.description

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
      description: 'The created escalation',
      properties: {
        id: { type: 'string', description: 'The escalation ID' },
        title: { type: 'string', description: 'The escalation title' },
        status: { type: 'string', description: 'The current escalation status' },
        description: {
          type: 'string',
          description: 'Additional detail provided with this escalation',
        },
        priority: {
          type: 'object',
          description: 'The escalation priority',
          properties: { name: { type: 'string', description: 'Priority name' } },
        },
        created_at: { type: 'string', description: 'When the escalation was created' },
        updated_at: { type: 'string', description: 'When the escalation was last updated' },
      },
    },
  },
}
