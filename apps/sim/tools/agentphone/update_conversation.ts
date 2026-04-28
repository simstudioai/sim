import type {
  AgentPhoneConversationMessage,
  AgentPhoneUpdateConversationParams,
  AgentPhoneUpdateConversationResult,
} from '@/tools/agentphone/types'
import type { ToolConfig } from '@/tools/types'

export const agentphoneUpdateConversationTool: ToolConfig<
  AgentPhoneUpdateConversationParams,
  AgentPhoneUpdateConversationResult
> = {
  id: 'agentphone_update_conversation',
  name: 'Update Conversation',
  description: 'Update conversation metadata (stored state). Pass null to clear existing metadata.',
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
    metadata: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Custom key-value metadata to store on the conversation. Pass null to clear existing metadata.',
    },
  },

  request: {
    url: (params) => `https://api.agentphone.to/v1/conversations/${params.conversationId.trim()}`,
    method: 'PATCH',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {}
      if (params.metadata !== undefined) body.metadata = params.metadata
      return body
    },
  },

  transformResponse: async (response): Promise<AgentPhoneUpdateConversationResult> => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: data?.detail?.[0]?.msg ?? data?.message ?? 'Failed to update conversation',
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

    const rawMessages = Array.isArray(data?.messages) ? data.messages : []
    const messages: AgentPhoneConversationMessage[] = rawMessages.map(
      (message: Record<string, unknown>) => ({
        id: (message.id as string) ?? '',
        body: (message.body as string) ?? '',
        fromNumber: (message.fromNumber as string) ?? '',
        toNumber: (message.toNumber as string) ?? '',
        direction: (message.direction as string) ?? '',
        channel: (message.channel as string | null) ?? null,
        mediaUrl: (message.mediaUrl as string | null) ?? null,
        receivedAt: (message.receivedAt as string) ?? '',
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
    messageCount: { type: 'number', description: 'Number of messages' },
    metadata: {
      type: 'json',
      description: 'Custom metadata stored on the conversation',
      optional: true,
    },
    createdAt: { type: 'string', description: 'ISO 8601 timestamp' },
    messages: {
      type: 'array',
      description: 'Messages in the conversation',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Message ID' },
          body: { type: 'string', description: 'Message body' },
          fromNumber: { type: 'string', description: 'Sender phone number' },
          toNumber: { type: 'string', description: 'Recipient phone number' },
          direction: { type: 'string', description: 'inbound or outbound' },
          channel: {
            type: 'string',
            description: 'Channel (sms, mms, etc.)',
            optional: true,
          },
          mediaUrl: {
            type: 'string',
            description: 'Media URL if any',
            optional: true,
          },
          receivedAt: { type: 'string', description: 'ISO 8601 timestamp' },
        },
      },
    },
  },
}
