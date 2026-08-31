import type { SlackAppendStreamV2Params, SlackStreamV2Response } from '@/tools/slack/types'
import {
  assertSlackApiSuccess,
  buildSlackStreamContent,
  requireSlackString,
  resolveSlackAccessToken,
} from '@/tools/slack/utils'
import type { ToolConfig } from '@/tools/types'

interface SlackAppendStreamApiResponse {
  ok?: boolean
  error?: string
  channel?: string
  ts?: string
}

export const slackAppendStreamV2Tool: ToolConfig<SlackAppendStreamV2Params, SlackStreamV2Response> =
  {
    id: 'slack_append_stream_v2',
    name: 'Slack Append Stream',
    description: 'Append Markdown or structured chunks to an active Slack stream.',
    version: '2.0.0',
    oauth: {
      required: true,
      provider: 'slack',
      requiredScopes: ['chat:write'],
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
        description: 'Channel containing the streaming message',
      },
      ts: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Timestamp returned by Start Stream',
      },
      markdownText: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Markdown content to append, mutually exclusive with chunks',
      },
      chunks: {
        type: 'json',
        required: false,
        visibility: 'user-or-llm',
        description: 'Structured Slack streaming chunks, mutually exclusive with Markdown',
      },
    },
    request: {
      url: () => 'https://slack.com/api/chat.appendStream',
      method: 'POST',
      headers: (params) => ({
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: `Bearer ${resolveSlackAccessToken(params)}`,
      }),
      body: (params) => ({
        channel: requireSlackString(params.channel, 'Channel'),
        ts: requireSlackString(params.ts, 'Stream Timestamp'),
        ...buildSlackStreamContent(params, true),
      }),
    },
    transformResponse: async (response) => {
      const data = (await response.json()) as SlackAppendStreamApiResponse
      assertSlackApiSuccess(data, 'Failed to append Slack stream')
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
      ok: { type: 'boolean', description: 'Whether Slack appended the stream content' },
      channel: { type: 'string', description: 'Channel containing the streaming message' },
      ts: { type: 'string', description: 'Streaming message timestamp' },
    },
  }
