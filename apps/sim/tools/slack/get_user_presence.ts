import type { SlackGetUserPresenceParams, SlackGetUserPresenceResponse } from '@/tools/slack/types'
import type { ToolConfig } from '@/tools/types'

export const slackGetUserPresenceTool: ToolConfig<
  SlackGetUserPresenceParams,
  SlackGetUserPresenceResponse
> = {
  id: 'slack_get_user_presence',
  name: 'Slack Get User Presence',
  description: 'Check whether a Slack user is currently active or away',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'slack',
  },

  params: {
    authMethod: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Authentication method: oauth or bot_token',
    },
    botToken: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Bot token for Custom Bot',
    },
    accessToken: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'OAuth access token or bot token for Slack API',
    },
    userId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'User ID to check presence for (e.g., U1234567890)',
    },
  },

  request: {
    url: (params: SlackGetUserPresenceParams) => {
      const url = new URL('https://slack.com/api/users.getPresence')
      url.searchParams.append('user', params.userId.trim())
      return url.toString()
    },
    method: 'GET',
    headers: (params: SlackGetUserPresenceParams) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.accessToken || params.botToken}`,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.ok) {
      if (data.error === 'user_not_found') {
        throw new Error('User not found. Please check the user ID and try again.')
      }
      if (data.error === 'missing_scope') {
        throw new Error(
          'Missing required permissions. Please reconnect your Slack account with the necessary scopes (users:read).'
        )
      }
      throw new Error(data.error || 'Failed to get user presence from Slack')
    }

    return {
      success: true,
      output: {
        presence: data.presence,
        online: data.online ?? null,
        autoAway: data.auto_away ?? null,
        manualAway: data.manual_away ?? null,
        connectionCount: data.connection_count ?? null,
        lastActivity: data.last_activity ?? null,
      },
    }
  },

  outputs: {
    presence: {
      type: 'string',
      description: 'User presence status: "active" or "away"',
    },
    online: {
      type: 'boolean',
      description:
        'Whether user has an active client connection (only available when checking own presence)',
      optional: true,
    },
    autoAway: {
      type: 'boolean',
      description:
        'Whether user was automatically set to away due to inactivity (only available when checking own presence)',
      optional: true,
    },
    manualAway: {
      type: 'boolean',
      description:
        'Whether user manually set themselves as away (only available when checking own presence)',
      optional: true,
    },
    connectionCount: {
      type: 'number',
      description:
        'Total number of active connections for the user (only available when checking own presence)',
      optional: true,
    },
    lastActivity: {
      type: 'number',
      description:
        'Unix timestamp of last detected activity (only available when checking own presence)',
      optional: true,
    },
  },
}
