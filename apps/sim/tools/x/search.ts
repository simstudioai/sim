import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type { XSearchParams, XSearchResponse } from '@/tools/x/types'
import { transformTweet, transformUser } from '@/tools/x/types'

const logger = createLogger('XSearchTool')

export const xSearchTool: ToolConfig<XSearchParams, XSearchResponse> = {
  id: 'x_search',
  name: 'X Search',
  description: 'Search for tweets using keywords, hashtags, or advanced queries',
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
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Search query (e.g., "AI news", "#technology", "from:username"). Supports X search operators',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of results to return (e.g., 10, 25, 50). Default: 10, max: 100',
    },
    startTime: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Start time for search (ISO 8601 format)',
    },
    endTime: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'End time for search (ISO 8601 format)',
    },
    sortOrder: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort order for results (recency or relevancy)',
    },
  },

  request: {
    url: (params) => {
      const query = params.query
      const expansions = [
        'author_id',
        'referenced_tweets.id',
        'attachments.media_keys',
        'attachments.poll_ids',
      ].join(',')

      const queryParams = new URLSearchParams({
        query,
        expansions,
        'tweet.fields':
          'created_at,conversation_id,in_reply_to_user_id,attachments,context_annotations,public_metrics',
        'user.fields': 'name,username,description,profile_image_url,verified,public_metrics',
      })

      if (params.maxResults && Number(params.maxResults) < 10) {
        queryParams.append('max_results', '10')
      } else if (params.maxResults) {
        queryParams.append('max_results', Number(params.maxResults).toString())
      }
      if (params.startTime) queryParams.append('start_time', params.startTime)
      if (params.endTime) queryParams.append('end_time', params.endTime)
      if (params.sortOrder) queryParams.append('sort_order', params.sortOrder)

      return `https://api.twitter.com/2/tweets/search/recent?${queryParams.toString()}`
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
      logger.error('X Search API Error:', JSON.stringify(data, null, 2))
      return {
        success: false,
        error:
          data.error?.detail ||
          data.error?.title ||
          'No results found or invalid response from X API',
        output: {
          tweets: [],
          includes: {
            users: [],
            media: [],
            polls: [],
          },
          meta: data.meta || {
            resultCount: 0,
            newestId: null,
            oldestId: null,
            nextToken: null,
          },
        },
      }
    }

    return {
      success: true,
      output: {
        tweets: data.data.map(transformTweet),
        includes: {
          users: data.includes?.users?.map(transformUser) || [],
          media: data.includes?.media || [],
          polls: data.includes?.polls || [],
        },
        meta: {
          resultCount: data.meta.result_count,
          newestId: data.meta.newest_id,
          oldestId: data.meta.oldest_id,
          nextToken: data.meta.next_token,
        },
      },
    }
  },

  outputs: {
    tweets: {
      type: 'array',
      description: 'Array of tweets matching the search query',
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
    includes: {
      type: 'object',
      description: 'Additional data including user profiles and media',
      optional: true,
    },
    meta: {
      type: 'object',
      description: 'Search metadata including result count and pagination tokens',
      properties: {
        resultCount: { type: 'number', description: 'Number of results returned' },
        newestId: { type: 'string', description: 'ID of the newest tweet' },
        oldestId: { type: 'string', description: 'ID of the oldest tweet' },
      },
    },
  },
}
