import type {
  AgentPhoneConversationMessage,
  AgentPhoneGetConversationMessagesParams,
  AgentPhoneGetConversationMessagesResult,
} from '@/tools/agentphone/types'
import type { ToolConfig } from '@/tools/types'

export const agentphoneGetConversationMessagesTool: ToolConfig<
  AgentPhoneGetConversationMessagesParams,
  AgentPhoneGetConversationMessagesResult
> = {
  id: 'agentphone_get_conversation_messages',
  name: 'Get Conversation Messages',
  description: 'Get paginated messages for a conversation',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AgentPhone API key',
    },
    conversationId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Conversation ID',
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
      return `https://api.agentphone.to/v1/conversations/${params.conversationId.trim()}/messages${qs ? `?${qs}` : ''}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response): Promise<AgentPhoneGetConversationMessagesResult> => {
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
        data: (data.data ?? []).map(
          (msg: Record<string, unknown>): AgentPhoneConversationMessage => ({
            id: (msg.id as string) ?? '',
            body: (msg.body as string) ?? '',
            fromNumber: (msg.fromNumber as string) ?? '',
            toNumber: (msg.toNumber as string) ?? '',
            direction: (msg.direction as string) ?? '',
            channel: (msg.channel as string | null) ?? null,
            mediaUrl: (msg.mediaUrl as string | null) ?? null,
            receivedAt: (msg.receivedAt as string) ?? '',
          })
        ),
        hasMore: data.hasMore ?? false,
      },
    }
  },

  outputs: {
    data: {
      type: 'array',
      description: 'Messages in the conversation',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Message ID' },
          body: { type: 'string', description: 'Message text' },
          fromNumber: { type: 'string', description: 'Sender phone number' },
          toNumber: { type: 'string', description: 'Recipient phone number' },
          direction: { type: 'string', description: 'inbound or outbound' },
          channel: { type: 'string', description: 'sms, mms, or imessage', optional: true },
          mediaUrl: { type: 'string', description: 'Attached media URL', optional: true },
          receivedAt: { type: 'string', description: 'ISO 8601 timestamp' },
        },
      },
    },
    hasMore: { type: 'boolean', description: 'Whether more messages are available' },
  },
}
