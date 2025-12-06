import type { SlackGetUserParams, SlackGetUserResponse } from '@/tools/slack/types'
import type { ToolConfig } from '@/tools/types'

export const slackGetUserTool: ToolConfig<SlackGetUserParams, SlackGetUserResponse> = {
  id: 'slack_get_user',
  name: 'Slack Get User Info',
  description: 'Get detailed information about a specific Slack user by their user ID.',
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
      description: 'User ID to look up (e.g., U1234567890)',
    },
  },

  request: {
    url: (params: SlackGetUserParams) => {
      const url = new URL('https://slack.com/api/users.info')
      url.searchParams.append('user', params.userId)
      return url.toString()
    },
    method: 'GET',
    headers: (params: SlackGetUserParams) => ({
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
      if (data.error === 'invalid_auth') {
        throw new Error('Invalid authentication. Please check your Slack credentials.')
      }
      throw new Error(data.error || 'Failed to get user info from Slack')
    }

    const user = data.user
    const profile = user.profile || {}

    return {
      success: true,
      output: {
        user: {
          id: user.id,
          name: user.name,
          real_name: user.real_name || profile.real_name || '',
          display_name: profile.display_name || '',
          first_name: profile.first_name || '',
          last_name: profile.last_name || '',
          title: profile.title || '',
          phone: profile.phone || '',
          skype: profile.skype || '',
          is_bot: user.is_bot || false,
          is_admin: user.is_admin || false,
          is_owner: user.is_owner || false,
          is_primary_owner: user.is_primary_owner || false,
          is_restricted: user.is_restricted || false,
          is_ultra_restricted: user.is_ultra_restricted || false,
          deleted: user.deleted || false,
          timezone: user.tz,
          timezone_label: user.tz_label,
          timezone_offset: user.tz_offset,
          avatar_24: profile.image_24,
          avatar_48: profile.image_48,
          avatar_72: profile.image_72,
          avatar_192: profile.image_192,
          avatar_512: profile.image_512,
          status_text: profile.status_text || '',
          status_emoji: profile.status_emoji || '',
          status_expiration: profile.status_expiration,
          updated: user.updated,
        },
      },
    }
  },

  outputs: {
    user: {
      type: 'object',
      description: 'Detailed user information',
      properties: {
        id: { type: 'string', description: 'User ID' },
        name: { type: 'string', description: 'Username (handle)' },
        real_name: { type: 'string', description: 'Full real name' },
        display_name: { type: 'string', description: 'Display name shown in Slack' },
        first_name: { type: 'string', description: 'First name' },
        last_name: { type: 'string', description: 'Last name' },
        title: { type: 'string', description: 'Job title' },
        phone: { type: 'string', description: 'Phone number' },
        skype: { type: 'string', description: 'Skype handle' },
        is_bot: { type: 'boolean', description: 'Whether the user is a bot' },
        is_admin: { type: 'boolean', description: 'Whether the user is a workspace admin' },
        is_owner: { type: 'boolean', description: 'Whether the user is the workspace owner' },
        is_primary_owner: { type: 'boolean', description: 'Whether the user is the primary owner' },
        is_restricted: { type: 'boolean', description: 'Whether the user is a guest (restricted)' },
        is_ultra_restricted: {
          type: 'boolean',
          description: 'Whether the user is a single-channel guest',
        },
        deleted: { type: 'boolean', description: 'Whether the user is deactivated' },
        timezone: {
          type: 'string',
          description: 'Timezone identifier (e.g., America/Los_Angeles)',
        },
        timezone_label: { type: 'string', description: 'Human-readable timezone label' },
        timezone_offset: { type: 'number', description: 'Timezone offset in seconds from UTC' },
        avatar_24: { type: 'string', description: 'URL to 24px avatar' },
        avatar_48: { type: 'string', description: 'URL to 48px avatar' },
        avatar_72: { type: 'string', description: 'URL to 72px avatar' },
        avatar_192: { type: 'string', description: 'URL to 192px avatar' },
        avatar_512: { type: 'string', description: 'URL to 512px avatar' },
        status_text: { type: 'string', description: 'Custom status text' },
        status_emoji: { type: 'string', description: 'Custom status emoji' },
        status_expiration: { type: 'number', description: 'Unix timestamp when status expires' },
        updated: { type: 'number', description: 'Unix timestamp of last profile update' },
      },
    },
  },
}
