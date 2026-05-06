import type {
  AgentPhoneConversationSummary,
  AgentPhoneListConversationsParams,
  AgentPhoneListConversationsResult,
} from '@/tools/agentphone/types'
import type { ToolConfig } from '@/tools/types'

export const agentphoneListConversationsTool: ToolConfig<
  AgentPhoneListConversationsParams,
  AgentPhoneListConversationsResult
> = {
  id: 'agentphone_list_conversations',
  name: 'List Conversations',
  description: 'List conversations (message threads) for this AgentPhone account',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AgentPhone API key',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results to return (default 20, max 100)',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results to skip (min 0)',
    },
  },

  request: {
    url: (params) => {
      const query = new URLSearchParams()
      if (typeof params.limit === 'number') query.set('limit', String(params.limit))
      if (typeof params.offset === 'number') query.set('offset', String(params.offset))
      const qs = query.toString()
      return `https://api.agentphone.to/v1/conversations${qs ? `?${qs}` : ''}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response): Promise<AgentPhoneListConversationsResult> => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: data?.detail?.[0]?.msg ?? data?.message ?? 'Failed to list conversations',
        output: { data: [], hasMore: false, total: 0 },
      }
    }

    return {
      success: true,
      output: {
        data: (data.data ?? []).map(
          (conv: Record<string, unknown>): AgentPhoneConversationSummary => ({
            id: (conv.id as string) ?? '',
            agentId: (conv.agentId as string | null) ?? null,
            phoneNumberId: (conv.phoneNumberId as string) ?? '',
            phoneNumber: (conv.phoneNumber as string) ?? '',
            participant: (conv.participant as string) ?? '',
            lastMessageAt: (conv.lastMessageAt as string) ?? '',
            lastMessagePreview: (conv.lastMessagePreview as string) ?? '',
            messageCount: (conv.messageCount as number) ?? 0,
            metadata: (conv.metadata as Record<string, unknown> | null) ?? null,
            createdAt: (conv.createdAt as string) ?? '',
          })
        ),
        hasMore: data.hasMore ?? false,
        total: data.total ?? 0,
      },
    }
  },

  outputs: {
    data: {
      type: 'array',
      description: 'Conversations',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Conversation ID' },
          agentId: { type: 'string', description: 'Agent ID', optional: true },
          phoneNumberId: { type: 'string', description: 'Phone number ID' },
          phoneNumber: { type: 'string', description: 'Phone number' },
          participant: { type: 'string', description: 'External participant phone number' },
          lastMessageAt: { type: 'string', description: 'ISO 8601 timestamp' },
          lastMessagePreview: { type: 'string', description: 'Last message preview' },
          messageCount: { type: 'number', description: 'Number of messages in the conversation' },
          metadata: {
            type: 'json',
            description: 'Custom metadata stored on the conversation',
            optional: true,
          },
          createdAt: { type: 'string', description: 'ISO 8601 timestamp' },
        },
      },
    },
    hasMore: { type: 'boolean', description: 'Whether more results are available' },
    total: { type: 'number', description: 'Total number of conversations' },
  },
}
