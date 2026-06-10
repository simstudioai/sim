import type { SlackGetPermalinkParams, SlackGetPermalinkResponse } from '@/tools/slack/types'
import type { ToolConfig } from '@/tools/types'

export const slackGetPermalinkTool: ToolConfig<SlackGetPermalinkParams, SlackGetPermalinkResponse> =
  {
    id: 'slack_get_permalink',
    name: 'Slack Get Permalink',
    description: 'Get a stable permalink URL to a specific Slack message.',
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
        description: 'Channel ID containing the message (e.g., C1234567890)',
      },
      messageTs: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: "The message's ts value (e.g., 1405894322.002768)",
      },
    },

    request: {
      url: (params: SlackGetPermalinkParams) => {
        const url = new URL('https://slack.com/api/chat.getPermalink')
        url.searchParams.append('channel', params.channel?.trim() ?? '')
        url.searchParams.append('message_ts', params.messageTs?.trim() ?? '')
        return url.toString()
      },
      method: 'GET',
      headers: (params: SlackGetPermalinkParams) => ({
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.accessToken || params.botToken}`,
      }),
    },

    transformResponse: async (response: Response) => {
      const data = await response.json()

      if (!data.ok) {
        if (data.error === 'invalid_auth') {
          throw new Error('Invalid authentication. Please check your Slack credentials.')
        }
        if (data.error === 'channel_not_found') {
          throw new Error('Channel not found. Please check the channel ID.')
        }
        if (data.error === 'message_not_found') {
          throw new Error('Message not found. Please check the channel ID and message timestamp.')
        }
        throw new Error(data.error || 'Failed to get Slack permalink')
      }

      return {
        success: true,
        output: {
          ok: true,
          channel: data.channel ?? '',
          permalink: data.permalink ?? '',
        },
      }
    },

    outputs: {
      ok: {
        type: 'boolean',
        description: 'Whether the permalink was retrieved successfully',
      },
      channel: {
        type: 'string',
        description: 'Channel ID containing the message',
      },
      permalink: {
        type: 'string',
        description: 'The permalink URL to the message',
      },
    },
  }
