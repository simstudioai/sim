import type {
  AgentPhoneConversationMessage,
  AgentPhoneGetConversationParams,
  AgentPhoneGetConversationResult,
} from '@/tools/agentphone/types'
import type { ToolConfig } from '@/tools/types'

export const agentphoneGetConversationTool: ToolConfig<
  AgentPhoneGetConversationParams,
  AgentPhoneGetConversationResult
> = {
  id: 'agentphone_get_conversation',
  name: 'Get Conversation',
  description: 'Get a conversation along with its recent messages',
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
    messageLimit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of recent messages to include (default 50, max 100)',
    },
  },

  request: {
    url: (params) => {
      const query = new URLSearchParams()
      if (typeof params.messageLimit === 'number') {
        query.set('message_limit', String(params.messageLimit))
      }
      const qs = query.toString()
      return `https://api.agentphone.to/v1/conversations/${params.conversationId.trim()}${qs ? `?${qs}` : ''}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response): Promise<AgentPhoneGetConversationResult> => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: data?.detail?.[0]?.msg ?? data?.message ?? 'Failed to fetch conversation',
        output: {
          id: '',
          agentId: null,
          phoneNumberId: '',
          phoneNumber: '',
          participant: '',
          lastMessageAt: '',
          messageCount: 0,
          metadata: null,
          createdAt: '',
          messages: [],
        },
      }
    }

    const messages: AgentPhoneConversationMessage[] = (data.messages ?? []).map(
      (msg: Record<string, unknown>) => ({
        id: (msg.id as string) ?? '',
        body: (msg.body as string) ?? '',
        fromNumber: (msg.fromNumber as string) ?? '',
        toNumber: (msg.toNumber as string) ?? '',
        direction: (msg.direction as string) ?? '',
        channel: (msg.channel as string | null) ?? null,
        mediaUrl: (msg.mediaUrl as string | null) ?? null,
        receivedAt: (msg.receivedAt as string) ?? '',
      })
    )

    return {
      success: true,
      output: {
        id: data.id ?? '',
        agentId: data.agentId ?? null,
        phoneNumberId: data.phoneNumberId ?? '',
        phoneNumber: data.phoneNumber ?? '',
        participant: data.participant ?? '',
        lastMessageAt: data.lastMessageAt ?? '',
        messageCount: data.messageCount ?? 0,
        metadata: data.metadata ?? null,
        createdAt: data.createdAt ?? '',
        messages,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Conversation ID' },
    agentId: { type: 'string', description: 'Agent ID', optional: true },
    phoneNumberId: { type: 'string', description: 'Phone number ID' },
    phoneNumber: { type: 'string', description: 'Phone number' },
    participant: { type: 'string', description: 'External participant phone number' },
    lastMessageAt: { type: 'string', description: 'ISO 8601 timestamp' },
    messageCount: { type: 'number', description: 'Number of messages in the conversation' },
    metadata: {
      type: 'json',
      description: 'Custom metadata stored on the conversation',
      optional: true,
    },
    createdAt: { type: 'string', description: 'ISO 8601 timestamp' },
    messages: {
      type: 'array',
      description: 'Recent messages in the conversation',
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
  },
}
