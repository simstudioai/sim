import type {
  AgentPhoneGetNumberMessagesParams,
  AgentPhoneGetNumberMessagesResult,
} from '@/tools/agentphone/types'
import type { ToolConfig } from '@/tools/types'

export const agentphoneGetNumberMessagesTool: ToolConfig<
  AgentPhoneGetNumberMessagesParams,
  AgentPhoneGetNumberMessagesResult
> = {
  id: 'agentphone_get_number_messages',
  name: 'Get Phone Number Messages',
  description: 'Fetch messages received on a specific phone number',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AgentPhone API key',
    },
    numberId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the phone number',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of messages to return (default 50, max 200)',
    },
    before: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return messages received before this ISO 8601 timestamp',
    },
    after: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return messages received after this ISO 8601 timestamp',
    },
  },

  request: {
    url: (params) => {
      const query = new URLSearchParams()
      if (typeof params.limit === 'number') query.set('limit', String(params.limit))
      if (params.before) query.set('before', params.before)
      if (params.after) query.set('after', params.after)
      const qs = query.toString()
      return `https://api.agentphone.to/v1/numbers/${params.numberId.trim()}/messages${qs ? `?${qs}` : ''}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response): Promise<AgentPhoneGetNumberMessagesResult> => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: data?.detail?.[0]?.msg ?? data?.message ?? 'Failed to fetch messages',
        output: { data: [], hasMore: false },
      }
    }

    return {
      success: true,
      output: {
        data: (data.data ?? []).map((msg: Record<string, unknown>) => ({
          id: (msg.id as string) ?? '',
          from_: (msg.from_ as string) ?? '',
          to: (msg.to as string) ?? '',
          body: (msg.body as string) ?? '',
          direction: (msg.direction as string) ?? '',
          channel: (msg.channel as string | null) ?? null,
          receivedAt: (msg.receivedAt as string) ?? '',
        })),
        hasMore: data.hasMore ?? false,
      },
    }
  },

  outputs: {
    data: {
      type: 'array',
      description: 'Messages received on the number',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Message ID' },
          from_: { type: 'string', description: 'Sender phone number (E.164)' },
          to: { type: 'string', description: 'Recipient phone number (E.164)' },
          body: { type: 'string', description: 'Message text' },
          direction: { type: 'string', description: 'inbound or outbound' },
          channel: {
            type: 'string',
            description: 'Channel (sms, mms, etc.)',
            optional: true,
          },
          receivedAt: { type: 'string', description: 'ISO 8601 timestamp' },
        },
      },
    },
    hasMore: { type: 'boolean', description: 'Whether more messages are available' },
  },
}
