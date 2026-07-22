import type { SlackSetStatusParams, SlackSetStatusResponse } from '@/tools/slack/types'
import type { ToolConfig } from '@/tools/types'

/**
 * Normalizes the loading_messages input, which may arrive as a string array, a
 * JSON-encoded array, or a single string. Slack accepts up to 10 entries.
 */
function normalizeLoadingMessages(input: unknown): string[] | undefined {
  if (input == null) return undefined
  let value = input
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return undefined
    try {
      const parsed = JSON.parse(trimmed)
      value = Array.isArray(parsed) ? parsed : [trimmed]
    } catch {
      value = [trimmed]
    }
  }
  if (!Array.isArray(value)) return undefined
  const messages = value
    .map((m) => (typeof m === 'string' ? m.trim() : String(m)))
    .filter((m) => m.length > 0)
    .slice(0, 10)
  return messages.length > 0 ? messages : undefined
}

export const slackSetStatusTool: ToolConfig<SlackSetStatusParams, SlackSetStatusResponse> = {
  id: 'slack_set_status',
  name: 'Slack Set Assistant Status',
  description:
    'Set or clear the assistant thread status indicator (the loading shimmer) on a Slack AI app thread. Pass an empty status to clear it.',
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
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Status text to display, e.g. 'Working on it…'. Omit or pass an empty string to clear the status.",
    },
    loadingMessages: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Optional list of messages to rotate through as an animated loading indicator (max 10).',
    },
  },

  request: {
    url: () => 'https://slack.com/api/assistant.threads.setStatus',
    method: 'POST',
    headers: (params: SlackSetStatusParams) => ({
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${params.accessToken || params.botToken}`,
    }),
    body: (params: SlackSetStatusParams) => {
      const loadingMessages = normalizeLoadingMessages(params.loadingMessages)
      return {
        channel_id: params.channel?.trim(),
        thread_ts: params.threadTs?.trim(),
        status: params.status ?? '',
        ...(loadingMessages ? { loading_messages: loadingMessages } : {}),
      }
    },
  },

  transformResponse: async (response: Response, params?: SlackSetStatusParams) => {
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
      throw new Error(data.error || 'Failed to set Slack assistant status')
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
      description: 'Whether the status was set successfully',
    },
    channel: {
      type: 'string',
      description: 'Channel ID the status was set on',
    },
    threadTs: {
      type: 'string',
      description: 'Thread timestamp the status was set on',
    },
  },
}
