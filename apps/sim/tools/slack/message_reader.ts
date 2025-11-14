import type { SlackMessageReaderParams, SlackMessageReaderResponse } from '@/tools/slack/types'
import type { ToolConfig } from '@/tools/types'

export const slackMessageReaderTool: ToolConfig<
  SlackMessageReaderParams,
  SlackMessageReaderResponse
> = {
  id: 'slack_message_reader',
  name: 'Slack Message Reader',
  description:
    'Read the latest messages from Slack channels. Retrieve conversation history with filtering options.',
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
      visibility: 'user-only',
      description: 'Slack channel to read messages from (e.g., #general)',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of messages to retrieve (default: 10, max: 100)',
    },
    oldest: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Start of time range (timestamp)',
    },
    latest: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'End of time range (timestamp)',
    },
  },

  request: {
    url: (params: SlackMessageReaderParams) => {
      const url = new URL('https://slack.com/api/conversations.history')
      url.searchParams.append('channel', params.channel)
      // Cap limit at 15 due to Slack API restrictions for non-Marketplace apps
      const limit = params.limit ? Number(params.limit) : 10
      url.searchParams.append('limit', String(Math.min(limit, 15)))

      if (params.oldest) {
        url.searchParams.append('oldest', params.oldest)
      }
      if (params.latest) {
        url.searchParams.append('latest', params.latest)
      }

      return url.toString()
    },
    method: 'GET',
    headers: (params: SlackMessageReaderParams) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.accessToken || params.botToken}`,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.ok) {
      if (data.error === 'not_in_channel') {
        throw new Error(
          'Bot is not in the channel. Please invite the Sim bot to your Slack channel by typing: /invite @Sim Studio'
        )
      }
      if (data.error === 'channel_not_found') {
        throw new Error('Channel not found. Please check the channel ID and try again.')
      }
      if (data.error === 'missing_scope') {
        throw new Error(
          'Missing required permissions. Please reconnect your Slack account with the necessary scopes (channels:history, groups:history).'
        )
      }
      throw new Error(data.error || 'Failed to fetch messages from Slack')
    }

    const messages = (data.messages || []).map((message: any) => ({
      // Core properties
      type: message.type || 'message',
      ts: message.ts,
      text: message.text || '',
      user: message.user,
      bot_id: message.bot_id,
      username: message.username,
      channel: message.channel,
      team: message.team,

      // Thread properties
      thread_ts: message.thread_ts,
      parent_user_id: message.parent_user_id,
      reply_count: message.reply_count,
      reply_users_count: message.reply_users_count,
      latest_reply: message.latest_reply,
      subscribed: message.subscribed,
      last_read: message.last_read,
      unread_count: message.unread_count,

      // Message subtype
      subtype: message.subtype,

      // Reactions and interactions
      reactions: message.reactions?.map((reaction: any) => ({
        name: reaction.name,
        count: reaction.count,
        users: reaction.users || [],
      })),
      is_starred: message.is_starred,
      pinned_to: message.pinned_to,

      // Content attachments
      files: message.files?.map((file: any) => ({
        id: file.id,
        name: file.name,
        mimetype: file.mimetype,
        size: file.size,
        url_private: file.url_private,
        permalink: file.permalink,
        mode: file.mode,
      })),
      attachments: message.attachments,
      blocks: message.blocks,

      // Metadata
      edited: message.edited
        ? {
            user: message.edited.user,
            ts: message.edited.ts,
          }
        : undefined,
      permalink: message.permalink,
    }))

    return {
      success: true,
      output: {
        messages,
      },
    }
  },

  outputs: {
    messages: {
      type: 'array',
      description: 'Array of message objects from the channel',
      items: {
        type: 'object',
        properties: {
          // Core properties
          type: { type: 'string', description: 'Message type' },
          ts: { type: 'string', description: 'Message timestamp' },
          text: { type: 'string', description: 'Message text content' },
          user: { type: 'string', description: 'User ID who sent the message' },
          bot_id: { type: 'string', description: 'Bot ID if sent by a bot' },
          username: { type: 'string', description: 'Display username' },
          channel: { type: 'string', description: 'Channel ID' },
          team: { type: 'string', description: 'Team ID' },

          // Thread properties
          thread_ts: { type: 'string', description: 'Thread parent message timestamp' },
          parent_user_id: { type: 'string', description: 'User ID of thread parent' },
          reply_count: { type: 'number', description: 'Number of thread replies' },
          reply_users_count: { type: 'number', description: 'Number of users who replied' },
          latest_reply: { type: 'string', description: 'Timestamp of latest reply' },
          subscribed: { type: 'boolean', description: 'Whether user is subscribed to thread' },
          last_read: { type: 'string', description: 'Last read timestamp' },
          unread_count: { type: 'number', description: 'Number of unread messages' },

          // Message subtype
          subtype: { type: 'string', description: 'Message subtype' },

          // Reactions and interactions
          reactions: {
            type: 'array',
            description: 'Array of reactions on this message',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'Emoji name' },
                count: { type: 'number', description: 'Number of reactions' },
                users: {
                  type: 'array',
                  description: 'Array of user IDs who reacted',
                  items: { type: 'string' },
                },
              },
            },
          },
          is_starred: { type: 'boolean', description: 'Whether message is starred' },
          pinned_to: {
            type: 'array',
            description: 'Array of channel IDs where message is pinned',
            items: { type: 'string' },
          },

          // Content attachments
          files: {
            type: 'array',
            description: 'Array of files attached to message',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'File ID' },
                name: { type: 'string', description: 'File name' },
                mimetype: { type: 'string', description: 'MIME type' },
                size: { type: 'number', description: 'File size in bytes' },
                url_private: { type: 'string', description: 'Private download URL' },
                permalink: { type: 'string', description: 'Permanent link to file' },
                mode: { type: 'string', description: 'File mode' },
              },
            },
          },
          attachments: {
            type: 'array',
            description: 'Array of legacy attachments',
            items: { type: 'object' },
          },
          blocks: {
            type: 'array',
            description: 'Array of Block Kit blocks',
            items: { type: 'object' },
          },

          // Metadata
          edited: {
            type: 'object',
            description: 'Edit information if message was edited',
            properties: {
              user: { type: 'string', description: 'User ID who edited' },
              ts: { type: 'string', description: 'Edit timestamp' },
            },
          },
          permalink: { type: 'string', description: 'Permanent link to message' },
        },
      },
    },
  },
}
