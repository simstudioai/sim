import type { SlackSetTitleParams, SlackSetTitleResponse } from '@/tools/slack/types'
import type { ToolConfig } from '@/tools/types'

export const slackSetTitleTool: ToolConfig<SlackSetTitleParams, SlackSetTitleResponse> = {
  id: 'slack_set_title',
  name: 'Slack Set Assistant Title',
  description: 'Set the title of a Slack assistant thread (shown in the AI app thread header).',
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
      description: 'Channel ID containing the assistant thread (e.g., C1234567890 or D1234567890)',
    },
    threadTs: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Thread timestamp (thread_ts) of the assistant thread (e.g., 1405894322.002768)',
    },
    title: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The title to display for the assistant thread',
    },
  },

  request: {
    url: () => 'https://slack.com/api/assistant.threads.setTitle',
    method: 'POST',
    headers: (params: SlackSetTitleParams) => ({
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${params.accessToken || params.botToken}`,
    }),
    body: (params: SlackSetTitleParams) => ({
      channel_id: params.channel?.trim(),
      thread_ts: params.threadTs?.trim(),
      title: params.title,
    }),
  },

  transformResponse: async (response: Response, params?: SlackSetTitleParams) => {
    const data = await response.json()

    if (!data.ok) {
      if (data.error === 'missing_scope') {
        throw new Error(
          'Missing required permissions. Please reconnect your Slack account with the necessary scopes (assistant:write).'
        )
      }
      if (data.error === 'invalid_auth') {
        throw new Error('Invalid authentication. Please check your Slack credentials.')
      }
      if (data.error === 'channel_not_found') {
        throw new Error('Channel not found. Please check the channel ID.')
      }
      if (data.error === 'invalid_thread_ts') {
        throw new Error('Invalid thread timestamp. Please check the thread_ts value.')
      }
      throw new Error(data.error || 'Failed to set Slack assistant title')
    }

    return {
      success: true,
      output: {
        ok: true,
        channel: params?.channel?.trim() ?? '',
        threadTs: params?.threadTs?.trim() ?? '',
      },
    }
  },

  outputs: {
    ok: {
      type: 'boolean',
      description: 'Whether the title was set successfully',
    },
    channel: {
      type: 'string',
      description: 'Channel ID the title was set on',
    },
    threadTs: {
      type: 'string',
      description: 'Thread timestamp the title was set on',
    },
  },
}
