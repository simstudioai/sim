import type {
  InstagramListStoriesParams,
  InstagramListStoriesResponse,
} from '@/tools/instagram/types'
import { bearerHeaders, graphUrl, readGraphError } from '@/tools/instagram/utils'
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
  },

  request: {
    url: (params) => {
      const path = params.igUserId?.trim() ? `/${params.igUserId.trim()}/stories` : '/me/stories'
      return graphUrl(path, {
        fields: 'id,media_type,media_url,timestamp',
      })
    },
    method: 'GET',
    headers: (params) => bearerHeaders(params.accessToken),
  },

  transformResponse: async (response): Promise<InstagramListStoriesResponse> => {
    if (!response.ok) {
      return {
        success: false,
        output: { stories: [] },
        error: await readGraphError(response),
      }
    }

    const data = await response.json()
    const items = Array.isArray(data.data) ? data.data : []

    return {
      success: true,
      output: {
        stories: items.map((item: Record<string, unknown>) => ({
          id: String(item.id ?? ''),
          mediaType: (item.media_type as string | undefined) ?? null,
          mediaUrl: (item.media_url as string | undefined) ?? null,
          timestamp: (item.timestamp as string | undefined) ?? null,
        })),
      },
    }
  },

  outputs: {
    stories: {
      type: 'json',
      description: 'Active stories (id, mediaType, mediaUrl, timestamp)',
    },
  },
}
