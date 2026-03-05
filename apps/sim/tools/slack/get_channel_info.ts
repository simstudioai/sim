import type { SlackGetChannelInfoParams, SlackGetChannelInfoResponse } from '@/tools/slack/types'
import { CHANNEL_OUTPUT_PROPERTIES } from '@/tools/slack/types'
import type { ToolConfig } from '@/tools/types'

export const slackGetChannelInfoTool: ToolConfig<
  SlackGetChannelInfoParams,
  SlackGetChannelInfoResponse
> = {
  id: 'slack_get_channel_info',
  name: 'Slack Get Channel Info',
  description: 'Get detailed information about a Slack channel by its ID',
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
      description: 'Channel ID to get information about (e.g., C1234567890)',
    },
    includeNumMembers: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to include the member count in the response',
    },
  },

  request: {
    url: (params: SlackGetChannelInfoParams) => {
      const url = new URL('https://slack.com/api/conversations.info')
      url.searchParams.append('channel', params.channel.trim())
      url.searchParams.append('include_num_members', String(params.includeNumMembers ?? true))
      return url.toString()
    },
    method: 'GET',
    headers: (params: SlackGetChannelInfoParams) => ({
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
          'Missing required permissions. Please reconnect your Slack account with the necessary scopes (channels:read).'
        )
      }
      throw new Error(data.error || 'Failed to get channel info from Slack')
    }

    const channel = data.channel

    return {
      success: true,
      output: {
        channelInfo: {
          id: channel.id,
          name: channel.name ?? '',
          is_channel: channel.is_channel ?? false,
          is_private: channel.is_private ?? false,
          is_archived: channel.is_archived ?? false,
          is_general: channel.is_general ?? false,
          is_member: channel.is_member ?? false,
          is_shared: channel.is_shared ?? false,
          is_ext_shared: channel.is_ext_shared ?? false,
          is_org_shared: channel.is_org_shared ?? false,
          num_members: channel.num_members ?? null,
          topic: channel.topic?.value ?? '',
          purpose: channel.purpose?.value ?? '',
          created: channel.created ?? null,
          creator: channel.creator ?? null,
          updated: channel.updated ?? null,
        },
      },
    }
  },

  outputs: {
    channelInfo: {
      type: 'object',
      description: 'Detailed channel information',
      properties: CHANNEL_OUTPUT_PROPERTIES,
    },
  },
}
