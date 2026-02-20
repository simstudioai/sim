import type { SlackEphemeralMessageParams, SlackEphemeralMessageResponse } from '@/tools/slack/types'
import type { ToolConfig } from '@/tools/types'

export const slackEphemeralMessageTool: ToolConfig<
  SlackEphemeralMessageParams,
  SlackEphemeralMessageResponse
> = {
  id: 'slack_ephemeral_message',
  name: 'Slack Ephemeral Message',
  description:
    'Send ephemeral messages visible only to a specific user in Slack channels or threads. Messages are temporary and do not persist across sessions.',
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
    userId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'User ID who will see the ephemeral message (e.g., U1234567890)',
    },
    text: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Message text to send (supports Slack mrkdwn formatting)',
    },
    threadTs: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Thread timestamp to reply to (creates ephemeral thread reply)',
    },
  },

  request: {
    url: '/api/tools/slack/ephemeral-message',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params: SlackEphemeralMessageParams) => {
      const isDM = params.destinationType === 'dm'
      return {
        accessToken: params.accessToken || params.botToken,
        channel: isDM ? undefined : params.channel,
        dmUserId: isDM ? params.dmUserId : undefined,
        userId: params.userId,
        text: params.text,
        thread_ts: params.threadTs || undefined,
      }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!data.success) {
      throw new Error(data.error || 'Failed to send Slack ephemeral message')
    }
    return {
      success: true,
      output: data.output,
    }
  },

  outputs: {
    message_ts: { type: 'string', description: 'Ephemeral message timestamp' },
    channel: { type: 'string', description: 'Channel ID where message was sent' },
    user: { type: 'string', description: 'User ID who received the ephemeral message' },
  },
}
