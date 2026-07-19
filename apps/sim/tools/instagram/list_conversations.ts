import { INSTAGRAM_CONVERSATION_PROPERTIES } from '@/tools/instagram/output-properties'
import type {
  InstagramListConversationsParams,
  InstagramListConversationsResponse,
} from '@/tools/instagram/types'
import {
  bearerHeaders,
  clampGraphLimit,
  graphUrl,
  type InstagramGraphPage,
  readGraphError,
  readGraphJson,
} from '@/tools/instagram/utils'
import type { ToolConfig } from '@/tools/types'

export const instagramListConversationsTool: ToolConfig<
  InstagramListConversationsParams,
  InstagramListConversationsResponse
> = {
  id: 'instagram_list_conversations',
  name: 'Instagram List Conversations',
  description: 'List Instagram Direct conversations for the professional account',
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
    igUserId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Instagram professional account user id (defaults to /me)',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Max number of conversations to return (default 25, max 100)',
    },
    after: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor',
    },
  },

  request: {
    url: (params) => {
      const path = params.igUserId?.trim()
        ? `/${params.igUserId.trim()}/conversations`
        : '/me/conversations'
      return graphUrl(path, {
        platform: 'instagram',
        fields: 'id,updated_time',
        limit: String(clampGraphLimit(params.limit)),
        after: params.after?.trim() || undefined,
      })
    },
    method: 'GET',
    headers: (params) => bearerHeaders(params.accessToken),
  },

  transformResponse: async (response): Promise<InstagramListConversationsResponse> => {
    if (!response.ok) {
      return {
        success: false,
        output: { conversations: [], nextCursor: null },
        error: await readGraphError(response),
      }
    }

    const data = await readGraphJson<InstagramGraphPage<Record<string, unknown>>>(
      response,
      'Instagram conversations response'
    )
    const items = Array.isArray(data.data) ? data.data : []
    const conversations = items.flatMap((item: Record<string, unknown>) => {
      const id = item.id == null || item.id === '' ? null : String(item.id)
      if (!id) return []
      return [
        {
          id,
          updatedTime: typeof item.updated_time === 'string' ? item.updated_time : null,
        },
      ]
    })

    return {
      success: true,
      output: {
        conversations,
        nextCursor: data.paging?.next ? (data.paging?.cursors?.after ?? null) : null,
      },
    }
  },

  outputs: {
    conversations: {
      type: 'array',
      description: 'Instagram Direct conversations from this page',
      items: { type: 'object', properties: INSTAGRAM_CONVERSATION_PROPERTIES },
    },
    nextCursor: { type: 'string', description: 'Pagination cursor', optional: true },
  },
}
