import type {
  SlackSetConversationTopicParams,
  SlackSetConversationTopicResponse,
} from '@/tools/slack/types'
import { CHANNEL_OUTPUT_PROPERTIES } from '@/tools/slack/types'
import type { ToolConfig } from '@/tools/types'

export const slackSetConversationTopicTool: ToolConfig<
  SlackSetConversationTopicParams,
  SlackSetConversationTopicResponse
> = {
  id: 'slack_set_conversation_topic',
  name: 'Slack Set Conversation Topic',
  description: 'Set the topic for a Slack channel (max 250 characters).',
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
      description: 'ID of the channel to update (e.g., C1234567890)',
    },
    topic: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'New topic text (max 250 characters; no formatting or linkification)',
    },
  },

  request: {
    url: 'https://slack.com/api/conversations.setTopic',
    method: 'POST',
    headers: (params: SlackSetConversationTopicParams) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.accessToken || params.botToken}`,
    }),
    body: (params: SlackSetConversationTopicParams) => ({
      channel: params.channel?.trim(),
      topic: params.topic,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.ok) {
      if (data.error === 'too_long') {
        throw new Error('The topic is too long. The maximum length is 250 characters.')
      }
      if (data.error === 'channel_not_found') {
        throw new Error('Channel not found. Please verify the channel ID.')
      }
      if (data.error === 'not_in_channel') {
        throw new Error('The authenticated user is not a member of this channel.')
      }
      if (data.error === 'missing_scope') {
        throw new Error(
          'Missing required permissions. Please reconnect your Slack account with the necessary scopes (channels:manage, groups:write).'
        )
      }
      if (data.error === 'invalid_auth') {
        throw new Error('Invalid authentication. Please check your Slack credentials.')
      }
      throw new Error(data.error || 'Failed to set Slack conversation topic')
    }

    const ch = data.channel || {}

    return {
      success: true,
      output: {
        channelInfo: {
          id: ch.id,
          name: ch.name,
          is_private: ch.is_private || false,
          is_archived: ch.is_archived || false,
          is_member: ch.is_member || false,
          topic: ch.topic?.value || '',
          purpose: ch.purpose?.value || '',
          created: ch.created,
          creator: ch.creator,
        },
      },
    }
  },

  outputs: {
    channelInfo: {
      type: 'object',
      description: 'The channel object after updating the topic',
      properties: CHANNEL_OUTPUT_PROPERTIES,
    },
  },
}
