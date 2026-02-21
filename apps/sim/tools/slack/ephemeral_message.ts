import type {
  SlackEphemeralMessageParams,
  SlackEphemeralMessageResponse,
} from '@/tools/slack/types'
import type { ToolConfig } from '@/tools/types'

export const slackEphemeralMessageTool: ToolConfig<
  SlackEphemeralMessageParams,
  SlackEphemeralMessageResponse
> = {
  id: 'slack_ephemeral_message',
  name: 'Slack Ephemeral Message',
  description:
    'Send an ephemeral message visible only to a specific user in a channel. Optionally reply in a thread. The message does not persist across sessions.',
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
    user: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'User ID who will see the ephemeral message (e.g., U1234567890). Must be a member of the channel.',
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
      description:
        'Thread timestamp to reply in. When provided, the ephemeral message appears as a thread reply.',
    },
    blocks: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Block Kit layout blocks as a JSON array. When provided, text becomes the fallback notification text.',
    },
  },

  request: {
    url: '/api/tools/slack/send-ephemeral',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params: SlackEphemeralMessageParams) => ({
      accessToken: params.accessToken || params.botToken,
      channel: params.channel,
      user: params.user?.trim(),
      text: params.text,
      thread_ts: params.threadTs || undefined,
      blocks:
        typeof params.blocks === 'string' ? JSON.parse(params.blocks) : params.blocks || undefined,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!data.success) {
      throw new Error(data.error || 'Failed to send ephemeral message')
    }
    return {
      success: true,
      output: data.output,
    }
  },

  outputs: {
    messageTs: {
      type: 'string',
      description: 'Timestamp of the ephemeral message (cannot be used with chat.update)',
    },
    channel: {
      type: 'string',
      description: 'Channel ID where the ephemeral message was sent',
    },
  },
}
