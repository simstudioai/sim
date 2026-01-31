import type { SlackGetMessageParams, SlackGetMessageResponse } from '@/tools/slack/types'
import { MESSAGE_OUTPUT_PROPERTIES } from '@/tools/slack/types'
import type { ToolConfig } from '@/tools/types'

export const slackGetMessageTool: ToolConfig<SlackGetMessageParams, SlackGetMessageResponse> = {
  id: 'slack_get_message',
  name: 'Slack Get Message',
  description:
    'Retrieve a specific message by its timestamp. Useful for getting a thread parent message.',
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
      description: 'Slack channel ID (e.g., C1234567890)',
    },
    timestamp: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Message timestamp to retrieve (e.g., 1405894322.002768)',
    },
  },

  request: {
    url: (params: SlackGetMessageParams) => {
      const url = new URL('https://slack.com/api/conversations.history')
      url.searchParams.append('channel', params.channel?.trim() ?? '')
      url.searchParams.append('oldest', params.timestamp?.trim() ?? '')
      url.searchParams.append('limit', '1')
      url.searchParams.append('inclusive', 'true')
      return url.toString()
    },
    method: 'GET',
    headers: (params: SlackGetMessageParams) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.accessToken || params.botToken}`,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.ok) {
      if (data.error === 'missing_scope') {
        throw new Error(
          'Missing required permissions. Please reconnect your Slack account with the necessary scopes (channels:history, groups:history).'
        )
      }
      if (data.error === 'invalid_auth') {
        throw new Error('Invalid authentication. Please check your Slack credentials.')
      }
      if (data.error === 'channel_not_found') {
        throw new Error('Channel not found. Please check the channel ID.')
      }
      throw new Error(data.error || 'Failed to get message from Slack')
    }

    const messages = data.messages || []
    if (messages.length === 0) {
      throw new Error('Message not found')
    }

    const msg = messages[0]
    const message = {
      type: msg.type ?? 'message',
      ts: msg.ts,
      text: msg.text ?? '',
      user: msg.user ?? null,
      bot_id: msg.bot_id ?? null,
      username: msg.username ?? null,
      channel: msg.channel ?? null,
      team: msg.team ?? null,
      thread_ts: msg.thread_ts ?? null,
      parent_user_id: msg.parent_user_id ?? null,
      reply_count: msg.reply_count ?? null,
      reply_users_count: msg.reply_users_count ?? null,
      latest_reply: msg.latest_reply ?? null,
      subscribed: msg.subscribed ?? null,
      last_read: msg.last_read ?? null,
      unread_count: msg.unread_count ?? null,
      subtype: msg.subtype ?? null,
      reactions: msg.reactions ?? [],
      is_starred: msg.is_starred ?? false,
      pinned_to: msg.pinned_to ?? [],
      files: (msg.files ?? []).map((f: any) => ({
        id: f.id,
        name: f.name,
        mimetype: f.mimetype,
        size: f.size,
        url_private: f.url_private ?? null,
        permalink: f.permalink ?? null,
        mode: f.mode ?? null,
      })),
      attachments: msg.attachments ?? [],
      blocks: msg.blocks ?? [],
      edited: msg.edited ?? null,
      permalink: msg.permalink ?? null,
    }

    return {
      success: true,
      output: {
        message,
      },
    }
  },

  outputs: {
    message: {
      type: 'object',
      description: 'The retrieved message object',
      properties: MESSAGE_OUTPUT_PROPERTIES,
    },
  },
}
