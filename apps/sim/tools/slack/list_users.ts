import type { SlackListUsersParams, SlackListUsersResponse } from '@/tools/slack/types'
import { USER_SUMMARY_OUTPUT_PROPERTIES } from '@/tools/slack/types'
import type { ToolConfig } from '@/tools/types'

export const slackListUsersTool: ToolConfig<SlackListUsersParams, SlackListUsersResponse> = {
  id: 'slack_list_users',
  name: 'Slack List Users',
  description: 'List all users in a Slack workspace. Returns user profiles with names and avatars.',
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
    includeDeleted: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include deactivated/deleted users (default: false)',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of users to return (default: 100, max: 200)',
    },
  },

  request: {
    url: (params: SlackListUsersParams) => {
      const url = new URL('https://slack.com/api/users.list')

      // Set limit (default 100, max 200)
      const limit = params.limit ? Math.min(Number(params.limit), 200) : 100
      url.searchParams.append('limit', String(limit))

      return url.toString()
    },
    method: 'GET',
    headers: (params: SlackListUsersParams) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.accessToken || params.botToken}`,
    }),
  },

  transformResponse: async (response: Response, params?: SlackListUsersParams) => {
    const data = await response.json()

    if (!data.ok) {
      if (data.error === 'missing_scope') {
        throw new Error(
          'Missing required permissions. Please reconnect your Slack account with the necessary scopes (users:read).'
        )
      }
      if (data.error === 'invalid_auth') {
        throw new Error('Invalid authentication. Please check your Slack credentials.')
      }
      throw new Error(data.error || 'Failed to list users from Slack')
    }

    const includeDeleted = params?.includeDeleted === true

    const users = (data.members || [])
      .filter((user: any) => {
        // Always filter out Slackbot
        if (user.id === 'USLACKBOT') return false
        // Filter deleted users unless includeDeleted is true
        if (!includeDeleted && user.deleted) return false
        return true
      })
      .map((user: any) => ({
        id: user.id,
        name: user.name,
        real_name: user.real_name || user.profile?.real_name || '',
        display_name: user.profile?.display_name || '',
        is_bot: user.is_bot || false,
        is_admin: user.is_admin || false,
        is_owner: user.is_owner || false,
        deleted: user.deleted || false,
        timezone: user.tz,
        avatar: user.profile?.image_72 || user.profile?.image_48 || '',
        status_text: user.profile?.status_text || '',
        status_emoji: user.profile?.status_emoji || '',
      }))

    const ids = users.map((user: { id: string }) => user.id)
    const names = users.map((user: { name: string }) => user.name)

    return {
      success: true,
      output: {
        users,
        ids,
        names,
        count: users.length,
      },
    }
  },

  outputs: {
    users: {
      type: 'array',
      description: 'Array of user objects from the workspace',
      items: {
        type: 'object',
        properties: USER_SUMMARY_OUTPUT_PROPERTIES,
      },
    },
    ids: {
      type: 'array',
      description: 'Array of user IDs for easy access',
      items: { type: 'string', description: 'User ID' },
    },
    names: {
      type: 'array',
      description: 'Array of usernames for easy access',
      items: { type: 'string', description: 'Username' },
    },
    count: {
      type: 'number',
      description: 'Total number of users returned',
    },
  },
}
