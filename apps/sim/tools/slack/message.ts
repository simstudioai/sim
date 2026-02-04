import type { SlackMessageParams, SlackMessageResponse } from '@/tools/slack/types'
import { MESSAGE_OUTPUT_PROPERTIES } from '@/tools/slack/types'
import type { ToolConfig } from '@/tools/types'

export const slackMessageTool: ToolConfig<SlackMessageParams, SlackMessageResponse> = {
  id: 'slack_message',
  name: 'Slack Message',
  description:
    'Send messages to Slack channels or direct messages. Supports Slack mrkdwn formatting.',
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
    destinationType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Destination type: channel or dm',
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
      description: 'Slack channel ID (e.g., C1234567890)',
    },
    dmUserId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Slack user ID for direct messages (e.g., U1234567890)',
    },
    text: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Message text to send (supports Slack mrkdwn formatting)',
    },
    thread_ts: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Thread timestamp to reply to (creates thread reply)',
    },
    files: {
      type: 'file[]',
      required: false,
      visibility: 'user-only',
      description: 'Files to attach to the message',
    },
  },

  request: {
    url: '/api/tools/slack/send-message',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params: SlackMessageParams) => {
      const isDM = params.destinationType === 'dm'
      return {
        accessToken: params.accessToken || params.botToken,
        channel: isDM ? undefined : params.channel,
        userId: isDM ? params.dmUserId : params.userId,
        text: params.text,
        thread_ts: params.thread_ts || undefined,
        files: params.files || null,
      }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!data.success) {
      throw new Error(data.error || 'Failed to send Slack message')
    }
    return {
      success: true,
      output: data.output,
    }
  },

  outputs: {
    message: {
      type: 'object',
      description: 'Complete message object with all properties returned by Slack',
      properties: MESSAGE_OUTPUT_PROPERTIES,
    },
    // Legacy properties for backward compatibility
    ts: { type: 'string', description: 'Message timestamp' },
    channel: { type: 'string', description: 'Channel ID where message was sent' },
    fileCount: {
      type: 'number',
      description: 'Number of files uploaded (when files are attached)',
    },
    files: { type: 'file[]', description: 'Files attached to the message' },
  },
}
