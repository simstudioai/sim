import type {
  SlackSetSuggestedPromptsV2Params,
  SlackSetSuggestedPromptsV2Response,
} from '@/tools/slack/types'
import {
  assertSlackApiSuccess,
  parseSlackSuggestedPrompts,
  requireSlackString,
  resolveSlackAccessToken,
} from '@/tools/slack/utils'
import type { ToolConfig } from '@/tools/types'

interface SlackSetSuggestedPromptsApiResponse {
  ok?: boolean
  error?: string
}

export const slackSetSuggestedPromptsV2Tool: ToolConfig<
  SlackSetSuggestedPromptsV2Params,
  SlackSetSuggestedPromptsV2Response
> = {
  id: 'slack_set_suggested_prompts_v2',
  name: 'Slack Set Agent Suggested Prompts',
  description: 'Set suggested prompts in Slack Agent View, optionally scoped to a specific thread.',
  version: '2.0.0',
  oauth: {
    required: true,
    provider: 'slack',
    requiredScopes: ['assistant:write'],
    credentialKind: 'service-account',
  },
  params: {
    authMethod: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'Slack authentication method',
    },
    botToken: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Custom Slack bot token',
    },
    accessToken: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'Resolved custom Slack bot token',
    },
    channel: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Agent direct-message channel ID',
    },
    threadTs: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional thread timestamp for legacy thread-scoped prompts',
    },
    prompts: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'One to four prompt objects with title and message fields',
    },
    promptsTitle: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional heading displayed above the prompt chips',
    },
  },
  request: {
    url: () => 'https://slack.com/api/assistant.threads.setSuggestedPrompts',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${resolveSlackAccessToken(params)}`,
    }),
    body: (params) => ({
      channel_id: requireSlackString(params.channel, 'Channel'),
      prompts: parseSlackSuggestedPrompts(params.prompts),
      ...(params.threadTs?.trim() ? { thread_ts: params.threadTs.trim() } : {}),
      ...(params.promptsTitle?.trim() ? { title: params.promptsTitle.trim() } : {}),
    }),
  },
  transformResponse: async (response) => {
    const data = (await response.json()) as SlackSetSuggestedPromptsApiResponse
    assertSlackApiSuccess(data, 'Failed to set Slack agent suggested prompts')
    return { success: true, output: { ok: true } }
  },
  outputs: {
    ok: { type: 'boolean', description: 'Whether Slack updated the suggested prompts' },
  },
}
