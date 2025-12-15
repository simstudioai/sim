import type { SlackDMParams, SlackDMResponse } from '@/tools/slack/types'
import type { ToolConfig } from '@/tools/types'

export const slackDMTool: ToolConfig<SlackDMParams, SlackDMResponse> = {
  id: 'slack_dm',
  name: 'Slack DM',
  description:
    'Send direct messages to Slack users through the Slack API. Supports Slack mrkdwn formatting.',
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
    userId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Target Slack user ID to send the direct message to',
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
    url: '/api/tools/slack/send-dm',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params: SlackDMParams) => {
      return {
        accessToken: params.accessToken || params.botToken,
        userId: params.userId,
        text: params.text,
        thread_ts: params.thread_ts || undefined,
        files: params.files || null,
      }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!data.success) {
      throw new Error(data.error || 'Failed to send Slack DM')
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
    },
    ts: { type: 'string', description: 'Message timestamp' },
    channel: { type: 'string', description: 'DM channel ID where message was sent' },
    fileCount: {
      type: 'number',
      description: 'Number of files uploaded (when files are attached)',
    },
  },
}
