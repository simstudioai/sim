import type {
  InstagramListCommentsParams,
  InstagramListCommentsResponse,
} from '@/tools/instagram/types'
import { bearerHeaders, clampGraphLimit, graphUrl, readGraphError } from '@/tools/instagram/utils'
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
        fields: 'id,text,username,timestamp,like_count,hidden',
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

    const data = await response.json()
    const items = Array.isArray(data.data) ? data.data : []

    return {
      success: true,
      output: {
        comments: items.map((item: Record<string, unknown>) => ({
          id: String(item.id ?? ''),
          text: (item.text as string | undefined) ?? null,
          username: (item.username as string | undefined) ?? null,
          timestamp: (item.timestamp as string | undefined) ?? null,
          likeCount: (item.like_count as number | undefined) ?? null,
          hidden: (item.hidden as boolean | undefined) ?? null,
        })),
        // Graph includes cursors on every page; only `paging.next` signals another page.
        nextCursor: data.paging?.next ? (data.paging?.cursors?.after ?? null) : null,
      },
    }
  },

  outputs: {
    comments: {
      type: 'json',
      description: 'Comments (id, text, username, timestamp, likeCount, hidden)',
    },
    nextCursor: { type: 'string', description: 'Pagination cursor', optional: true },
  },
}
