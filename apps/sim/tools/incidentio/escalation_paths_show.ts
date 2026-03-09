import type {
  IncidentioEscalationPathsShowParams,
  IncidentioEscalationPathsShowResponse,
} from '@/tools/incidentio/types'
import type { ToolConfig } from '@/tools/types'

export const escalationPathsShowTool: ToolConfig<
  IncidentioEscalationPathsShowParams,
  IncidentioEscalationPathsShowResponse
> = {
  id: 'incidentio_escalation_paths_show',
  name: 'Show Escalation Path',
  description: 'Get details of a specific escalation path in incident.io',
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
      description: 'The ID of the escalation path (e.g., "01FCNDV6P870EA6S7TK1DSYDG0")',
    },
  },

  request: {
    url: (params) => `https://api.incident.io/v2/escalation_paths/${params.id}`,
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
        escalation_path: data.escalation_path || data,
      },
    }
  },

  outputs: {
    escalation_path: {
      type: 'object',
      description: 'The escalation path details',
      properties: {
        id: { type: 'string', description: 'The escalation path ID' },
        name: { type: 'string', description: 'The escalation path name' },
        path: {
          type: 'array',
          description: 'Array of escalation levels',
          items: {
            type: 'object',
            properties: {
              targets: {
                type: 'array',
                description: 'Targets for this level',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string', description: 'Target ID' },
                    type: { type: 'string', description: 'Target type' },
                    schedule_id: {
                      type: 'string',
                      description: 'Schedule ID if type is schedule',
                      optional: true,
                    },
                    user_id: {
                      type: 'string',
                      description: 'User ID if type is user',
                      optional: true,
                    },
                    urgency: { type: 'string', description: 'Urgency level' },
                  },
                },
              },
              time_to_ack_seconds: {
                type: 'number',
                description: 'Time to acknowledge in seconds',
              },
            },
          },
        },
        working_hours: {
          type: 'array',
          description: 'Working hours configuration',
          optional: true,
          items: {
            type: 'object',
            properties: {
              weekday: { type: 'string', description: 'Day of week' },
              start_time: { type: 'string', description: 'Start time' },
              end_time: { type: 'string', description: 'End time' },
            },
          },
        },
        created_at: { type: 'string', description: 'When the path was created' },
        updated_at: { type: 'string', description: 'When the path was last updated' },
      },
    },
  },
}
