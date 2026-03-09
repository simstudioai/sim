import type { SlackListMembersParams, SlackListMembersResponse } from '@/tools/slack/types'
import type { ToolConfig } from '@/tools/types'

export const slackListMembersTool: ToolConfig<SlackListMembersParams, SlackListMembersResponse> = {
  id: 'slack_list_members',
  name: 'Slack List Channel Members',
  description:
    'List all members (user IDs) in a Slack channel. Use with Get User Info to resolve IDs to names.',
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
    channel: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Channel ID to list members from',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of members to return (default: 100, max: 200)',
    },
  },

  request: {
    url: (params: SlackListMembersParams) => {
      const url = new URL('https://slack.com/api/conversations.members')
      url.searchParams.append('channel', params.channel)

      // Set limit (default 100, max 200)
      const limit = params.limit ? Math.min(Number(params.limit), 200) : 100
      url.searchParams.append('limit', String(limit))

      return url.toString()
    },
    method: 'GET',
    headers: (params: SlackListMembersParams) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.accessToken || params.botToken}`,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.ok) {
      if (data.error === 'channel_not_found') {
        throw new Error('Channel not found. Please check the channel ID and try again.')
      }
      if (data.error === 'missing_scope') {
        throw new Error(
          'Missing required permissions. Please reconnect your Slack account with the necessary scopes (channels:read, groups:read).'
        )
      }
      if (data.error === 'invalid_auth') {
        throw new Error('Invalid authentication. Please check your Slack credentials.')
      }
      throw new Error(data.error || 'Failed to list channel members from Slack')
    }

    const members = data.members || []

    return {
      success: true,
      output: {
        members,
        count: members.length,
      },
    }
  },

  outputs: {
    members: {
      type: 'array',
      description: 'Array of user IDs who are members of the channel (e.g., U1234567890)',
      items: {
        type: 'string',
      },
    },
    count: {
      type: 'number',
      description: 'Total number of members returned',
    },
  },
}
