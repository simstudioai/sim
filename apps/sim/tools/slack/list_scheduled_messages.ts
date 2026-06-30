import type {
  SlackListScheduledMessagesParams,
  SlackListScheduledMessagesResponse,
} from '@/tools/slack/types'
import { SCHEDULED_MESSAGE_OUTPUT_PROPERTIES } from '@/tools/slack/types'
import type { ToolConfig } from '@/tools/types'

export const slackListScheduledMessagesTool: ToolConfig<
  SlackListScheduledMessagesParams,
  SlackListScheduledMessagesResponse
> = {
  id: 'slack_list_scheduled_messages',
  name: 'Slack List Scheduled Messages',
  description:
    'List pending scheduled messages in a Slack workspace, optionally filtered by channel.',
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
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional channel ID to filter scheduled messages (e.g., C1234567890)',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of scheduled messages to return',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor (next_cursor) from a previous response',
    },
    oldest: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Unix timestamp of the oldest scheduled message to include',
    },
    latest: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Unix timestamp of the latest scheduled message to include',
    },
    teamId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Encoded team ID (required only with org-level tokens)',
    },
  },

  request: {
    url: 'https://slack.com/api/chat.scheduledMessages.list',
    method: 'POST',
    headers: (params: SlackListScheduledMessagesParams) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.accessToken || params.botToken}`,
    }),
    body: (params: SlackListScheduledMessagesParams) => {
      const body: Record<string, unknown> = {}
      if (params.channel?.trim()) {
        body.channel = params.channel.trim()
      }
      if (params.limit != null) {
        body.limit = params.limit
      }
      if (params.cursor?.trim()) {
        body.cursor = params.cursor.trim()
      }
      if (params.oldest?.trim()) {
        body.oldest = params.oldest.trim()
      }
      if (params.latest?.trim()) {
        body.latest = params.latest.trim()
      }
      if (params.teamId?.trim()) {
        body.team_id = params.teamId.trim()
      }
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.ok) {
      if (data.error === 'invalid_auth') {
        throw new Error('Invalid authentication. Please check your Slack credentials.')
      }
      throw new Error(data.error || 'Failed to list scheduled Slack messages')
    }

    return {
      success: true,
      output: {
        scheduledMessages: data.scheduled_messages || [],
        nextCursor: data.response_metadata?.next_cursor || null,
      },
    }
  },

  outputs: {
    scheduledMessages: {
      type: 'array',
      description: 'Array of pending scheduled message objects',
      items: {
        type: 'object',
        properties: SCHEDULED_MESSAGE_OUTPUT_PROPERTIES,
      },
    },
    nextCursor: {
      type: 'string',
      description: 'Cursor for the next page (null when there are no more pages)',
      optional: true,
    },
  },
}
