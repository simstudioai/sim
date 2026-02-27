import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type { XGetLikedTweetsParams, XTweetListResponse } from '@/tools/x/types'
import { transformTweet, transformUser } from '@/tools/x/types'

const logger = createLogger('XGetLikedTweetsTool')

export const xGetLikedTweetsTool: ToolConfig<XGetLikedTweetsParams, XTweetListResponse> = {
  id: 'x_get_liked_tweets',
  name: 'X Get Liked Tweets',
  description: 'Get tweets liked by a specific user',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'x',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'X OAuth access token',
    },
    userId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The user ID whose liked tweets to retrieve',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of results (5-100)',
    },
    paginationToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination token for next page',
    },
  },

  request: {
    url: (params) => {
      const queryParams = new URLSearchParams({
        expansions: 'author_id,attachments.media_keys',
        'tweet.fields': 'created_at,conversation_id,public_metrics,context_annotations',
        'user.fields': 'name,username,description,profile_image_url,verified,public_metrics',
      })

      if (params.maxResults) {
        const max = Math.max(5, Math.min(100, Number(params.maxResults)))
        queryParams.append('max_results', max.toString())
      }
      if (params.paginationToken) queryParams.append('pagination_token', params.paginationToken)

      return `https://api.x.com/2/users/${params.userId.trim()}/liked_tweets?${queryParams.toString()}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!data.data || !Array.isArray(data.data)) {
      logger.error('X Get Liked Tweets API Error:', JSON.stringify(data, null, 2))
      return {
        success: false,
        output: {
          tweets: [],
          meta: {
            resultCount: 0,
            newestId: null,
            oldestId: null,
            nextToken: null,
            previousToken: null,
          },
        },
        error: data.errors?.[0]?.detail ?? 'No liked tweets found or invalid response',
      }
    }

    return {
      success: true,
      output: {
        tweets: data.data.map(transformTweet),
        includes: {
          users: data.includes?.users?.map(transformUser) ?? [],
        },
        meta: {
          resultCount: data.meta?.result_count ?? 0,
          newestId: data.meta?.newest_id ?? null,
          oldestId: data.meta?.oldest_id ?? null,
          nextToken: data.meta?.next_token ?? null,
          previousToken: data.meta?.previous_token ?? null,
        },
      },
    }
  },

  outputs: {
    tweets: {
      type: 'array',
      description: 'Array of liked tweets',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Tweet ID' },
          text: { type: 'string', description: 'Tweet content' },
          createdAt: { type: 'string', description: 'Creation timestamp' },
          authorId: { type: 'string', description: 'Author user ID' },
        },
      },
    },
    meta: {
      type: 'object',
      description: 'Pagination metadata',
      properties: {
        resultCount: { type: 'number', description: 'Number of results returned' },
        nextToken: { type: 'string', description: 'Token for next page', optional: true },
      },
    },
  },
}
