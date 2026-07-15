import { INSTAGRAM_STORY_PROPERTIES } from '@/tools/instagram/output-properties'
import type {
  InstagramListStoriesParams,
  InstagramListStoriesResponse,
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

export const instagramListStoriesTool: ToolConfig<
  InstagramListStoriesParams,
  InstagramListStoriesResponse
> = {
  id: 'instagram_list_stories',
  name: 'Instagram List Stories',
  description: 'List active stories on the Instagram professional account',
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
      description: 'Max number of active stories to return (default 25, max 100)',
    },
    after: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor from a previous List Stories response',
    },
  },

  request: {
    url: (params) => {
      const path = params.igUserId?.trim() ? `/${params.igUserId.trim()}/stories` : '/me/stories'
      return graphUrl(path, {
        fields: 'id,media_type,media_url,timestamp',
        limit: String(clampGraphLimit(params.limit)),
        after: params.after?.trim() || undefined,
      })
    },
    method: 'GET',
    headers: (params) => bearerHeaders(params.accessToken),
  },

  transformResponse: async (response): Promise<InstagramListStoriesResponse> => {
    if (!response.ok) {
      return {
        success: false,
        output: { stories: [], nextCursor: null },
        error: await readGraphError(response),
      }
    }

    const data = await readGraphJson<InstagramGraphPage<Record<string, unknown>>>(
      response,
      'Instagram stories response'
    )
    const items = Array.isArray(data.data) ? data.data : []
    const stories = items.flatMap((item: Record<string, unknown>) => {
      const id = item.id == null || item.id === '' ? null : String(item.id)
      if (!id) return []

      return [
        {
          id,
          mediaType: typeof item.media_type === 'string' ? item.media_type : null,
          mediaUrl: typeof item.media_url === 'string' ? item.media_url : null,
          timestamp: typeof item.timestamp === 'string' ? item.timestamp : null,
        },
      ]
    })

    return {
      success: true,
      output: {
        stories,
        nextCursor: data.paging?.next ? (data.paging?.cursors?.after ?? null) : null,
      },
    }
  },

  outputs: {
    stories: {
      type: 'array',
      description: 'Active stories from this page',
      items: { type: 'object', properties: INSTAGRAM_STORY_PROPERTIES },
    },
    nextCursor: { type: 'string', description: 'Pagination cursor', optional: true },
  },
}
