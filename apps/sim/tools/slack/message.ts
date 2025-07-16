import type { ToolConfig } from '../types'
import type { SlackMessageParams, SlackMessageResponse } from './types'

export const slackMessageTool: ToolConfig<SlackMessageParams, SlackMessageResponse> = {
  id: 'slack_message',
  name: 'Slack Message',
  description:
    'Send messages to Slack channels or users through the Slack API. Supports Slack mrkdwn formatting.',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'slack',
    additionalScopes: [
      'channels:read',
      'groups:read',
      'chat:write',
      'chat:write.public',
      'users:read',
    ],
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
  },

  request: {
    url: 'https://slack.com/api/chat.postMessage',
    method: 'POST',
    headers: (params: SlackMessageParams) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.accessToken || params.botToken}`,
    }),
    body: (params: SlackMessageParams) => {
      const body: any = {
        channel: params.channel,
        markdown_text: params.text,
      }

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!data.ok) {
      throw new Error(data.error || 'Slack API error')
    }
    return {
      success: true,
      output: {
        ts: data.ts,
        channel: data.channel,
      },
    }
  },

  transformError: (error: any) => {
    const message = error.message || 'Slack message failed'
    return message
  },
}
