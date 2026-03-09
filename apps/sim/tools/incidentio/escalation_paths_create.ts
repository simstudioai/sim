import type {
  IncidentioEscalationPathsCreateParams,
  IncidentioEscalationPathsCreateResponse,
} from '@/tools/incidentio/types'
import type { ToolConfig } from '@/tools/types'

export const escalationPathsCreateTool: ToolConfig<
  IncidentioEscalationPathsCreateParams,
  IncidentioEscalationPathsCreateResponse
> = {
  id: 'incidentio_escalation_paths_create',
  name: 'Create Escalation Path',
  description: 'Create a new escalation path in incident.io',
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
      description: 'Name of the escalation path (e.g., "Critical Incident Path")',
    },
    path: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Array of escalation levels with targets and time to acknowledge in seconds. Each level should have: targets (array of {id, type, schedule_id?, user_id?, urgency}) and time_to_ack_seconds (number)',
    },
    working_hours: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional working hours configuration. Array of {weekday, start_time, end_time}',
    },
  },

  request: {
    url: 'https://api.incident.io/v2/escalation_paths',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
    body: (params) => {
      const body: Record<string, any> = {
        name: params.name,
        path: params.path,
      }

      if (params.working_hours) {
        body.working_hours = params.working_hours
      }

      return body
    },
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
      description: 'The created escalation path',
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
