import type {
  SlackArchiveConversationParams,
  SlackArchiveConversationResponse,
} from '@/tools/slack/types'
import type { ToolConfig } from '@/tools/types'

export const slackArchiveConversationTool: ToolConfig<
  SlackArchiveConversationParams,
  SlackArchiveConversationResponse
> = {
  id: 'slack_archive_conversation',
  name: 'Slack Archive Conversation',
  description: 'Archive a Slack channel so it is closed to new activity.',
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
      description: 'ID of the channel to archive (e.g., C1234567890)',
    },
  },

  request: {
    url: 'https://slack.com/api/conversations.archive',
    method: 'POST',
    headers: (params: SlackArchiveConversationParams) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.accessToken || params.botToken}`,
    }),
    body: (params: SlackArchiveConversationParams) => ({
      channel: params.channel?.trim(),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.ok) {
      if (data.error === 'already_archived') {
        throw new Error('This channel is already archived.')
      }
      if (data.error === 'cant_archive_general') {
        throw new Error('The #general channel cannot be archived.')
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
      throw new Error(data.error || 'Failed to archive Slack conversation')
    }

    return {
      success: true,
      output: {
        ok: true,
      },
    }
  },

  outputs: {
    ok: {
      type: 'boolean',
      description: 'Whether the conversation was archived successfully',
    },
  },
}
