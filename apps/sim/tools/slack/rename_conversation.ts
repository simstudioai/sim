import type {
  SlackRenameConversationParams,
  SlackRenameConversationResponse,
} from '@/tools/slack/types'
import { CHANNEL_OUTPUT_PROPERTIES } from '@/tools/slack/types'
import type { ToolConfig } from '@/tools/types'

export const slackRenameConversationTool: ToolConfig<
  SlackRenameConversationParams,
  SlackRenameConversationResponse
> = {
  id: 'slack_rename_conversation',
  name: 'Slack Rename Conversation',
  description: 'Rename an existing Slack channel.',
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
      description: 'ID of the channel to rename (e.g., C1234567890)',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'New channel name (lowercase letters, numbers, hyphens, underscores only; max 80 characters)',
    },
  },

  request: {
    url: 'https://slack.com/api/conversations.rename',
    method: 'POST',
    headers: (params: SlackRenameConversationParams) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.accessToken || params.botToken}`,
    }),
    body: (params: SlackRenameConversationParams) => ({
      channel: params.channel?.trim(),
      name: params.name?.trim(),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.ok) {
      if (data.error === 'name_taken') {
        throw new Error('A channel with this name already exists in the workspace.')
      }
      if (
        data.error === 'invalid_name' ||
        data.error === 'invalid_name_specials' ||
        data.error === 'invalid_name_maxlength' ||
        data.error === 'invalid_name_required'
      ) {
        throw new Error(
          'Invalid channel name. Use only lowercase letters, numbers, hyphens, and underscores (max 80 characters).'
        )
      }
      if (data.error === 'channel_not_found') {
        throw new Error('Channel not found. Please verify the channel ID.')
      }
      if (data.error === 'not_in_channel') {
        throw new Error('The authenticated user is not a member of this channel.')
      }
      if (data.error === 'not_authorized') {
        throw new Error('You do not have permission to rename this channel.')
      }
      if (data.error === 'missing_scope') {
        throw new Error(
          'Missing required permissions. Please reconnect your Slack account with the necessary scopes (channels:manage, groups:write).'
        )
      }
      if (data.error === 'invalid_auth') {
        throw new Error('Invalid authentication. Please check your Slack credentials.')
      }
      throw new Error(data.error || 'Failed to rename Slack conversation')
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
      description: 'The channel object after renaming',
      properties: CHANNEL_OUTPUT_PROPERTIES,
    },
  },
}
