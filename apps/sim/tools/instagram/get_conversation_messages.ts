import { INSTAGRAM_MESSAGE_REFERENCE_PROPERTIES } from '@/tools/instagram/output-properties'
import type {
  InstagramGetConversationMessagesParams,
  InstagramGetConversationMessagesResponse,
} from '@/tools/instagram/types'
import {
  bearerHeaders,
  clampGraphLimit,
  graphUrl,
  type InstagramGraphPage,
  idString,
  readGraphError,
  readGraphJson,
} from '@/tools/instagram/utils'
import type { ToolConfig } from '@/tools/types'

function buildMessagesField(limit: number | undefined, after: string | undefined): string {
  const cursor = after?.trim()
  const pagination = cursor ? `.after(${cursor})` : ''
  return `messages.limit(${clampGraphLimit(limit)})${pagination}{id,created_time,is_unsupported}`
}

export const instagramGetConversationMessagesTool: ToolConfig<
  InstagramGetConversationMessagesParams,
  InstagramGetConversationMessagesResponse
> = {
  id: 'instagram_get_conversation_messages',
  name: 'Instagram Get Conversation Messages',
  description:
    'List cursor-paginated message references; full details are available only for the 20 most recent messages',
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
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Max number of message references to return (default 25, max 100)',
    },
    after: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Nested messages pagination cursor',
    },
  },

  request: {
    url: (params) =>
      graphUrl(`/${params.conversationId.trim()}`, {
        fields: buildMessagesField(params.limit, params.after),
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
        output: {
          conversationId: params?.conversationId?.trim() ?? '',
          messages: [],
          nextCursor: null,
        },
        error: await readGraphError(response),
      }
    }

    const data = await readGraphJson<{
      id?: string | number
      messages?: InstagramGraphPage<Record<string, unknown>>
    }>(response, 'Instagram conversation messages response')
    const items = Array.isArray(data.messages?.data) ? data.messages.data : []
    const messages = items.flatMap((item: Record<string, unknown>) => {
      const id =
        typeof item.id === 'string' || typeof item.id === 'number' ? idString(item.id) : null
      if (!id) return []

      return [
        {
          id,
          createdTime: typeof item.created_time === 'string' ? item.created_time : null,
          isUnsupported: item.is_unsupported === true,
        },
      ]
    })

    return {
      success: true,
      output: {
        conversationId: params?.conversationId?.trim() || idString(data.id) || '',
        messages,
        nextCursor:
          data.messages?.paging?.next && typeof data.messages?.paging?.cursors?.after === 'string'
            ? data.messages.paging.cursors.after
            : null,
      },
    }
  },

  outputs: {
    conversationId: { type: 'string', description: 'Conversation id' },
    messages: {
      type: 'array',
      description:
        'Message references (id, createdTime). Use Get Message for sender, recipient, and text.',
      items: { type: 'object', properties: INSTAGRAM_MESSAGE_REFERENCE_PROPERTIES },
    },
    nextCursor: {
      type: 'string',
      description: 'Nested messages pagination cursor',
      optional: true,
    },
  },
}
