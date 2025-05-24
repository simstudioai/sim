import type { ToolConfig } from '../types'
import type { SlackMessageParams, SlackMessageResponse } from './types'

export const slackMessageTool: ToolConfig<SlackMessageParams, SlackMessageResponse> = {
  id: 'slack_message',
  name: 'Slack Message',
  description:
    'Send messages to Slack channels or users through the Slack API. Enables direct communication and notifications with timestamp tracking and channel confirmation.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      requiredForToolCall: true,
      description: 'Your Slack API token',
    },
    channel: {
      type: 'string',
      required: true,
      description: 'Target Slack channel (e.g., #general)',
      optionalToolInput: true,
    },
    text: {
      type: 'string',
      required: true,
      description: 'Message text to send',
    },
  },

  request: {
    url: 'https://slack.com/api/chat.postMessage',
    method: 'POST',
    headers: (params: SlackMessageParams) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
    body: (params: SlackMessageParams) => ({
      channel: params.channel,
      text: params.text,
    }),
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
