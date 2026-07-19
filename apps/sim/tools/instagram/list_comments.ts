import { INSTAGRAM_COMMENT_PROPERTIES } from '@/tools/instagram/output-properties'
import type {
  InstagramListCommentsParams,
  InstagramListCommentsResponse,
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

export const instagramListCommentsTool: ToolConfig<
  InstagramListCommentsParams,
  InstagramListCommentsResponse
> = {
  id: 'instagram_list_comments',
  name: 'Instagram List Comments',
  description: 'List comments on an Instagram media object',
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
    mediaId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Instagram media id',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Max number of comments to return (default 25, max 100)',
    },
    after: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor',
    },
  },

  request: {
    url: (params) =>
      graphUrl(`/${params.mediaId.trim()}/comments`, {
        fields: 'id,text,from,timestamp,like_count,hidden',
        limit: String(clampGraphLimit(params.limit)),
        after: params.after?.trim() || undefined,
      }),
    method: 'GET',
    headers: (params) => bearerHeaders(params.accessToken),
  },

  transformResponse: async (response): Promise<InstagramListCommentsResponse> => {
    if (!response.ok) {
      return {
        success: false,
        output: { comments: [], nextCursor: null },
        error: await readGraphError(response),
      }
    }

    const data = await readGraphJson<InstagramGraphPage<Record<string, unknown>>>(
      response,
      'Instagram comments response'
    )
    const items = Array.isArray(data.data) ? data.data : []
    const comments = items.flatMap((item: Record<string, unknown>) => {
      const id = item.id == null || item.id === '' ? null : String(item.id)
      if (!id) return []

      const from =
        item.from && typeof item.from === 'object'
          ? (item.from as { username?: unknown })
          : undefined

      return [
        {
          id,
          text: typeof item.text === 'string' ? item.text : null,
          username:
            typeof from?.username === 'string'
              ? from.username
              : typeof item.username === 'string'
                ? item.username
                : null,
          timestamp: typeof item.timestamp === 'string' ? item.timestamp : null,
          likeCount: typeof item.like_count === 'number' ? item.like_count : null,
          hidden: typeof item.hidden === 'boolean' ? item.hidden : null,
        },
      ]
    })

    return {
      success: true,
      output: {
        comments,
        nextCursor: data.paging?.next ? (data.paging?.cursors?.after ?? null) : null,
      },
    }
  },

  outputs: {
    comments: {
      type: 'array',
      description: 'Comments on the media object',
      items: { type: 'object', properties: INSTAGRAM_COMMENT_PROPERTIES },
    },
    nextCursor: { type: 'string', description: 'Pagination cursor', optional: true },
  },
}
