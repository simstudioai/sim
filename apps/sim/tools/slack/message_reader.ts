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
      required: false,
      visibility: 'user-only',
      description: 'Slack channel to read messages from (e.g., #general)',
    },
    userId: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'User ID for DM conversation (e.g., U1234567890)',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of messages to retrieve (default: 10, max: 15)',
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
    url: '/api/tools/slack/read-messages',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params: SlackMessageReaderParams) => ({
      accessToken: params.accessToken || params.botToken,
      channel: params.channel,
      userId: params.userId,
      limit: params.limit,
      oldest: params.oldest,
      latest: params.latest,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      throw new Error(data.error || 'Failed to fetch messages from Slack')
    }

    return {
      success: true,
      output: data.output,
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
