import type {
  SlackSetConversationPurposeParams,
  SlackSetConversationPurposeResponse,
} from '@/tools/slack/types'
import type { ToolConfig } from '@/tools/types'

export const slackSetConversationPurposeTool: ToolConfig<
  SlackSetConversationPurposeParams,
  SlackSetConversationPurposeResponse
> = {
  id: 'slack_set_conversation_purpose',
  name: 'Slack Set Conversation Purpose',
  description: 'Set the purpose (description) for a Slack channel (max 250 characters).',
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
    purpose: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'New purpose/description text (max 250 characters)',
    },
  },

  request: {
    url: 'https://slack.com/api/conversations.setPurpose',
    method: 'POST',
    headers: (params: SlackSetConversationPurposeParams) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.accessToken || params.botToken}`,
    }),
    body: (params: SlackSetConversationPurposeParams) => ({
      channel: params.channel?.trim(),
      purpose: params.purpose,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.ok) {
      if (data.error === 'too_long') {
        throw new Error('The purpose is too long. The maximum length is 250 characters.')
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
      throw new Error(data.error || 'Failed to set Slack conversation purpose')
    }

    return {
      success: true,
      output: {
        purpose: data.purpose ?? '',
      },
    }
  },

  outputs: {
    purpose: {
      type: 'string',
      description: 'The purpose/description that was set on the channel',
    },
  },
}
