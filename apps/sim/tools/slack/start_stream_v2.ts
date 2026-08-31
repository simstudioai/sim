import type { SlackStartStreamV2Params, SlackStreamV2Response } from '@/tools/slack/types'
import {
  assertSlackApiSuccess,
  buildSlackStreamContent,
  requireSlackString,
  resolveSlackAccessToken,
} from '@/tools/slack/utils'
import type { ToolConfig } from '@/tools/types'

interface SlackStartStreamApiResponse {
  ok?: boolean
  error?: string
  channel?: string
  ts?: string
}

export const slackStartStreamV2Tool: ToolConfig<SlackStartStreamV2Params, SlackStreamV2Response> = {
  id: 'slack_start_stream_v2',
  name: 'Slack Start Stream',
  description: 'Start a streaming Slack message using Markdown or structured chunks.',
  version: '2.0.0',
  oauth: {
    required: true,
    provider: 'slack',
    requiredScopes: ['chat:write', 'chat:write.customize'],
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
      description: 'Channel ID where Slack should create the streaming message',
    },
    markdownText: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Initial Markdown content, mutually exclusive with chunks',
    },
    chunks: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Initial structured Slack streaming chunks, mutually exclusive with Markdown',
    },
    threadTs: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Parent thread timestamp when streaming a reply',
    },
    recipientUserId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Recipient user ID, required with Recipient Team ID when channel is not a DM',
    },
    recipientTeamId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Recipient workspace ID, required with Recipient User ID when channel is not a DM',
    },
    taskDisplayMode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Task display mode: timeline or plan',
    },
    iconEmoji: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Emoji used to customize the streaming agent identity',
    },
    iconUrl: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Image URL used to customize the streaming agent identity',
    },
    username: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Display name used to customize the streaming agent identity',
    },
  },
  request: {
    url: () => 'https://slack.com/api/chat.startStream',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${resolveSlackAccessToken(params)}`,
    }),
    body: (params) => {
      if (params.taskDisplayMode && !['timeline', 'plan'].includes(params.taskDisplayMode)) {
        throw new Error('Task Display Mode must be timeline or plan')
      }
      const recipientUserId = params.recipientUserId?.trim()
      const recipientTeamId = params.recipientTeamId?.trim()
      const channel = requireSlackString(params.channel, 'Channel')
      if (Boolean(recipientUserId) !== Boolean(recipientTeamId)) {
        throw new Error('Recipient User ID and Recipient Team ID must be provided together')
      }
      if (!channel.startsWith('D') && !recipientUserId) {
        throw new Error('Recipient User ID and Recipient Team ID are required for channel streams')
      }

      return {
        channel,
        ...buildSlackStreamContent(params, false),
        ...(params.threadTs?.trim() ? { thread_ts: params.threadTs.trim() } : {}),
        ...(recipientUserId ? { recipient_user_id: recipientUserId } : {}),
        ...(recipientTeamId ? { recipient_team_id: recipientTeamId } : {}),
        ...(params.taskDisplayMode ? { task_display_mode: params.taskDisplayMode } : {}),
        ...(params.iconEmoji?.trim() ? { icon_emoji: params.iconEmoji.trim() } : {}),
        ...(params.iconUrl?.trim() ? { icon_url: params.iconUrl.trim() } : {}),
        ...(params.username?.trim() ? { username: params.username.trim() } : {}),
      }
    },
  },
  transformResponse: async (response) => {
    const data = (await response.json()) as SlackStartStreamApiResponse
    assertSlackApiSuccess(data, 'Failed to start Slack stream')
    return {
      success: true,
      output: {
        ok: true,
        channel: requireSlackString(data.channel, 'Slack response channel'),
        ts: requireSlackString(data.ts, 'Slack response timestamp'),
      },
    }
  },
  outputs: {
    ok: { type: 'boolean', description: 'Whether Slack started the stream' },
    channel: { type: 'string', description: 'Channel containing the streaming message' },
    ts: { type: 'string', description: 'Timestamp used to append to or stop the stream' },
  },
}
