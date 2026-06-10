import type {
  SlackSetSuggestedPromptsParams,
  SlackSetSuggestedPromptsResponse,
  SlackSuggestedPrompt,
} from '@/tools/slack/types'
import type { ToolConfig } from '@/tools/types'

/**
 * Normalizes the prompts input into Slack's `[{ title, message }]` shape. Accepts
 * a structured array or a JSON-encoded string (as supplied from a block input).
 */
function normalizePrompts(input: unknown): SlackSuggestedPrompt[] {
  let value = input
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return []
    try {
      value = JSON.parse(trimmed)
    } catch {
      return []
    }
  }
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null
      const title = typeof (entry as any).title === 'string' ? (entry as any).title.trim() : ''
      const message =
        typeof (entry as any).message === 'string' ? (entry as any).message.trim() : ''
      if (!title || !message) return null
      return { title, message }
    })
    .filter((p): p is SlackSuggestedPrompt => p !== null)
}

export const slackSetSuggestedPromptsTool: ToolConfig<
  SlackSetSuggestedPromptsParams,
  SlackSetSuggestedPromptsResponse
> = {
  id: 'slack_set_suggested_prompts',
  name: 'Slack Set Suggested Prompts',
  description:
    'Set the clickable suggested prompts shown in a Slack assistant thread (the prompt chips in an AI app).',
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
    prompts: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Array of prompts, each with a "title" (shown on the chip) and a "message" (sent when clicked). Max 4.',
    },
    promptsTitle: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "Optional heading for the prompt list, e.g. 'Suggested Prompts'",
    },
  },

  request: {
    url: () => 'https://slack.com/api/assistant.threads.setSuggestedPrompts',
    method: 'POST',
    headers: (params: SlackSetSuggestedPromptsParams) => ({
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${params.accessToken || params.botToken}`,
    }),
    body: (params: SlackSetSuggestedPromptsParams) => {
      const prompts = normalizePrompts(params.prompts).slice(0, 4)
      if (prompts.length === 0) {
        throw new Error(
          'At least one suggested prompt with a non-empty "title" and "message" is required.'
        )
      }
      const title = params.promptsTitle?.trim()
      return {
        channel_id: params.channel?.trim(),
        thread_ts: params.threadTs?.trim(),
        prompts,
        ...(title ? { title } : {}),
      }
    },
  },

  transformResponse: async (response: Response, params?: SlackSetSuggestedPromptsParams) => {
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
      throw new Error(data.error || 'Failed to set Slack suggested prompts')
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
      description: 'Whether the suggested prompts were set successfully',
    },
    channel: {
      type: 'string',
      description: 'Channel ID the prompts were set on',
    },
    threadTs: {
      type: 'string',
      description: 'Thread timestamp the prompts were set on',
    },
  },
}
