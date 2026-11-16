import type {
  IncidentioEscalationsShowParams,
  IncidentioEscalationsShowResponse,
} from '@/tools/incidentio/types'
import { INCIDENTIO_CREDENTIAL_OAUTH } from '@/tools/shared/saved-credentials'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const escalationsShowTool: ToolConfig<
  IncidentioEscalationsShowParams,
  IncidentioEscalationsShowResponse
> = {
  id: 'incidentio_escalations_show',
  name: 'Show Escalation',
  description:
    'Get an escalation (a page sent to people) in incident.io. For an escalation policy, use Show Escalation Path.',
  version: '1.0.0',
  oauth: INCIDENTIO_CREDENTIAL_OAUTH,

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
      description: 'The ID of the escalation (e.g., "01FCNDV6P870EA6S7TK1DSYDG0")',
    },
  },

  request: {
    url: (params) =>
      `https://api.incident.io/v2/escalations/${safeUrlPathSegment(params.id, 'id')}`,
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
      description: 'The escalation details',
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
