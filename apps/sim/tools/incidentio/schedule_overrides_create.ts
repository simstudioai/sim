import type {
  IncidentioScheduleOverridesCreateParams,
  IncidentioScheduleOverridesCreateResponse,
} from '@/tools/incidentio/types'
import type { ToolConfig } from '@/tools/types'

export const scheduleOverridesCreateTool: ToolConfig<
  IncidentioScheduleOverridesCreateParams,
  IncidentioScheduleOverridesCreateResponse
> = {
  id: 'incidentio_schedule_overrides_create',
  name: 'Create Schedule Override',
  description: 'Create a new schedule override in incident.io',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'incident.io API Key',
    },
    rotation_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the rotation to override',
    },
    schedule_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the schedule',
    },
    user_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The ID of the user to assign (provide one of: user_id, user_email, or user_slack_id)',
    },
    user_email: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The email of the user to assign (provide one of: user_id, user_email, or user_slack_id)',
    },
    user_slack_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The Slack ID of the user to assign (provide one of: user_id, user_email, or user_slack_id)',
    },
    start_at: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'When the override starts (ISO 8601 format)',
    },
    end_at: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'When the override ends (ISO 8601 format)',
    },
  },

  request: {
    url: 'https://api.incident.io/v2/schedule_overrides',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
    body: (params) => {
      const user: { id?: string; email?: string; slack_user_id?: string } = {}
      if (params.user_id) user.id = params.user_id
      if (params.user_email) user.email = params.user_email
      if (params.user_slack_id) user.slack_user_id = params.user_slack_id

      return {
        rotation_id: params.rotation_id,
        schedule_id: params.schedule_id,
        user,
        start_at: params.start_at,
        end_at: params.end_at,
      }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        override: data.override || data,
      },
    }
  },

  outputs: {
    override: {
      type: 'object',
      description: 'The created schedule override',
      properties: {
        id: { type: 'string', description: 'The override ID' },
        rotation_id: { type: 'string', description: 'The rotation ID' },
        schedule_id: { type: 'string', description: 'The schedule ID' },
        user: {
          type: 'object',
          description: 'User assigned to this override',
          properties: {
            id: { type: 'string', description: 'User ID' },
            name: { type: 'string', description: 'User name' },
            email: { type: 'string', description: 'User email' },
          },
        },
        start_at: { type: 'string', description: 'When the override starts' },
        end_at: { type: 'string', description: 'When the override ends' },
        created_at: { type: 'string', description: 'When the override was created' },
        updated_at: { type: 'string', description: 'When the override was last updated' },
      },
    },
  },
}
