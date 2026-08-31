import { isRecordLike } from '@sim/utils/object'
import type {
  SlackStopStreamMessage,
  SlackStopStreamV2Params,
  SlackStopStreamV2Response,
} from '@/tools/slack/types'
import {
  assertSlackApiSuccess,
  buildSlackStopStreamExtras,
  requireSlackString,
  resolveSlackAccessToken,
} from '@/tools/slack/utils'
import type { ToolConfig } from '@/tools/types'

interface SlackStopStreamApiResponse {
  ok?: boolean
  error?: string
  channel?: string
  ts?: string
  message?: unknown
}

function mapStopStreamMessage(value: unknown): SlackStopStreamMessage {
  if (!isRecordLike(value)) throw new Error('Slack response message is required')
  if (typeof value.text !== 'string') throw new Error('Slack response message text is required')
  return {
    text: value.text,
    bot_id: typeof value.bot_id === 'string' ? value.bot_id : null,
    ts: requireSlackString(value.ts, 'Slack response message timestamp'),
    type: requireSlackString(value.type, 'Slack response message type'),
    subtype: typeof value.subtype === 'string' ? value.subtype : null,
  }
}

export const slackStopStreamV2Tool: ToolConfig<SlackStopStreamV2Params, SlackStopStreamV2Response> =
  {
    id: 'slack_stop_stream_v2',
    name: 'Slack Stop Stream',
    description: 'Finalize an active Slack stream and return the resulting message.',
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
        description: 'Final Markdown content, mutually exclusive with chunks',
      },
      chunks: {
        type: 'json',
        required: false,
        visibility: 'user-or-llm',
        description: 'Final structured Slack chunks, mutually exclusive with Markdown',
      },
      blocks: {
        type: 'json',
        required: false,
        visibility: 'user-or-llm',
        description: 'Final Block Kit blocks, as an array of up to 50 block objects',
      },
      metadata: {
        type: 'json',
        required: false,
        visibility: 'user-or-llm',
        description: 'Message metadata containing event_type and event_payload',
      },
      sessionStatus: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Final agent session state: active, processing, suspended, or closed',
      },
    },
    request: {
      url: () => 'https://slack.com/api/chat.stopStream',
      method: 'POST',
      headers: (params) => ({
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: `Bearer ${resolveSlackAccessToken(params)}`,
      }),
      body: (params) => ({
        channel: requireSlackString(params.channel, 'Channel'),
        ts: requireSlackString(params.ts, 'Stream Timestamp'),
        ...buildSlackStopStreamExtras(params),
      }),
    },
    transformResponse: async (response) => {
      const data = (await response.json()) as SlackStopStreamApiResponse
      assertSlackApiSuccess(data, 'Failed to stop Slack stream')
      return {
        success: true,
        output: {
          ok: true,
          channel: requireSlackString(data.channel, 'Slack response channel'),
          ts: requireSlackString(data.ts, 'Slack response timestamp'),
          message: mapStopStreamMessage(data.message),
        },
      }
    },
    outputs: {
      ok: { type: 'boolean', description: 'Whether Slack finalized the stream' },
      channel: { type: 'string', description: 'Channel containing the finalized message' },
      ts: { type: 'string', description: 'Finalized streaming message timestamp' },
      message: {
        type: 'object',
        description: 'Final Slack message returned by chat.stopStream',
        properties: {
          text: { type: 'string', description: 'Final message text' },
          bot_id: {
            type: 'string',
            description: 'Bot ID, or null when Slack omits it',
            nullable: true,
          },
          ts: { type: 'string', description: 'Message timestamp' },
          type: { type: 'string', description: 'Message type' },
          subtype: {
            type: 'string',
            description: 'Message subtype, or null when the message has no subtype',
            nullable: true,
          },
        },
      },
    },
  }
