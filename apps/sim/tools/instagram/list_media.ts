import type { InstagramListMediaParams, InstagramListMediaResponse } from '@/tools/instagram/types'
import { bearerHeaders, clampGraphLimit, graphUrl, readGraphError } from '@/tools/instagram/utils'
import type { ToolConfig } from '@/tools/types'

const MEDIA_FIELDS =
  'id,caption,media_type,media_product_type,media_url,permalink,timestamp,like_count,comments_count'

export const instagramListMediaTool: ToolConfig<
  InstagramListMediaParams,
  InstagramListMediaResponse
> = {
  id: 'instagram_list_media',
  name: 'Instagram List Media',
  description: 'List recent media on the Instagram professional account',
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
      description: 'Max number of media items to return (default 25, max 100)',
    },
    after: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor from a previous list_media response',
    },
  },

  request: {
    url: (params) => {
      const path = params.igUserId?.trim() ? `/${params.igUserId.trim()}/media` : '/me/media'
      return graphUrl(path, {
        fields: MEDIA_FIELDS,
        limit: String(clampGraphLimit(params.limit)),
        after: params.after?.trim() || undefined,
      })
    },
    method: 'GET',
    headers: (params) => bearerHeaders(params.accessToken),
  },

  transformResponse: async (response): Promise<InstagramListMediaResponse> => {
    if (!response.ok) {
      return {
        success: false,
        output: { media: [], nextCursor: null },
        error: await readGraphError(response),
      }
    }

    const data = await response.json()
    const items = Array.isArray(data.data) ? data.data : []

    return {
      success: true,
      output: {
        media: items.map((item: Record<string, unknown>) => ({
          id: String(item.id ?? ''),
          caption: (item.caption as string | undefined) ?? null,
          mediaType: (item.media_type as string | undefined) ?? null,
          mediaProductType: (item.media_product_type as string | undefined) ?? null,
          mediaUrl: (item.media_url as string | undefined) ?? null,
          permalink: (item.permalink as string | undefined) ?? null,
          timestamp: (item.timestamp as string | undefined) ?? null,
          likeCount: (item.like_count as number | undefined) ?? null,
          commentsCount: (item.comments_count as number | undefined) ?? null,
        })),
        // Graph includes cursors on every page; only `paging.next` signals another page.
        nextCursor: data.paging?.next ? (data.paging?.cursors?.after ?? null) : null,
      },
    }
  },

  outputs: {
    media: {
      type: 'json',
      description:
        'List of media objects (id, caption, mediaType, mediaProductType, mediaUrl, permalink, timestamp, likeCount, commentsCount)',
    },
    nextCursor: {
      type: 'string',
      description: 'Pagination cursor for the next page',
      optional: true,
    },
  },
}
