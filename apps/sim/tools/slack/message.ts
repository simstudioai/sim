import type { SlackMessageParams, SlackMessageResponse } from '@/tools/slack/types'
import type { ToolConfig } from '@/tools/types'

export const slackMessageTool: ToolConfig<SlackMessageParams, SlackMessageResponse> = {
  id: 'slack_message',
  name: 'Slack Message',
  description:
    'Send messages to Slack channels or users through the Slack API. Supports Slack mrkdwn formatting.',
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
      description: 'Target Slack channel (e.g., #general)',
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
      return {
        accessToken: params.accessToken || params.botToken,
        channel: params.channel,
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
    ts: { type: 'string', description: 'Message timestamp' },
    channel: { type: 'string', description: 'Channel ID where message was sent' },
  },
}
