import type {
  InstagramGetConversationMessagesParams,
  InstagramGetConversationMessagesResponse,
} from '@/tools/instagram/types'
import { bearerHeaders, graphUrl, readGraphError } from '@/tools/instagram/utils'
import type { ToolConfig } from '@/tools/types'

export const instagramGetConversationMessagesTool: ToolConfig<
  InstagramGetConversationMessagesParams,
  InstagramGetConversationMessagesResponse
> = {
  id: 'instagram_get_conversation_messages',
  name: 'Instagram Get Conversation Messages',
  description:
    'List recent message ids/content in a conversation (only the last ~20 messages are fetchable)',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'instagram',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Access token for Instagram API',
    },
    conversationId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Conversation id from list_conversations',
    },
  },

  request: {
    url: (params) =>
      graphUrl(`/${params.conversationId.trim()}`, {
        fields: 'messages{id,created_time,from,to,message}',
      }),
    method: 'GET',
    headers: (params) => bearerHeaders(params.accessToken),
  },

  transformResponse: async (
    response,
    params
  ): Promise<InstagramGetConversationMessagesResponse> => {
    if (!response.ok) {
      return {
        success: false,
        output: { conversationId: params?.conversationId ?? '', messages: [] },
        error: await readGraphError(response),
      }
    }

    const data = await response.json()
    const items = Array.isArray(data.messages?.data) ? data.messages.data : []

    return {
      success: true,
      output: {
        conversationId: params?.conversationId ?? data.id ?? '',
        messages: items.map((item: Record<string, unknown>) => {
          const from = item.from as { id?: string; username?: string } | undefined
          return {
            id: String(item.id ?? ''),
            createdTime: (item.created_time as string | undefined) ?? null,
            fromId: from?.id ?? null,
            fromUsername: from?.username ?? null,
            message: (item.message as string | undefined) ?? null,
          }
        }),
      },
    }
  },

  outputs: {
    conversationId: { type: 'string', description: 'Conversation id' },
    messages: {
      type: 'json',
      description: 'Messages (id, createdTime, fromId, fromUsername, message)',
    },
  },
}
