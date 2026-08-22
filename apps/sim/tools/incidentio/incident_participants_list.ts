import type {
  IncidentioIncidentParticipantsListParams,
  IncidentioIncidentParticipantsListResponse,
} from '@/tools/incidentio/types'
import type { ToolConfig } from '@/tools/types'

const PARTICIPANT_ITEMS = {
  type: 'object',
  properties: {
    participant_type: {
      type: 'string',
      description: 'The role they took in the incident (observer, collaborator, responder)',
    },
    user: {
      type: 'object',
      description: 'The participating user',
      properties: {
        id: { type: 'string', description: 'User ID' },
        name: { type: 'string', description: 'User display name' },
        email: { type: 'string', description: 'User email address', optional: true },
        role: { type: 'string', description: 'User role', optional: true },
        slack_user_id: { type: 'string', description: 'Slack user ID', optional: true },
      },
    },
  },
} as const

export const incidentParticipantsListTool: ToolConfig<
  IncidentioIncidentParticipantsListParams,
  IncidentioIncidentParticipantsListResponse
> = {
  id: 'incidentio_incident_participants_list',
  name: 'List Incident Participants',
  description:
    'List the participants of an incident in incident.io, split into those actively helping and those just observing',
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
      description:
        'The ID of the incident to find participants of (e.g., "01FDAG4SAP5TYPT98WGR2N7W91")',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://api.incident.io/v2/incident_participants')
      url.searchParams.set('incident_id', params.incident_id.trim())
      return url.toString()
    },
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
        active: data.incident_participants?.active ?? [],
        passive: data.incident_participants?.passive ?? [],
      },
    }
  },

  outputs: {
    active: {
      type: 'array',
      description: 'Participants who are actively helping with the incident',
      items: PARTICIPANT_ITEMS,
    },
    passive: {
      type: 'array',
      description: 'Participants who are just observing the incident',
      items: PARTICIPANT_ITEMS,
    },
  },
}
