import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type { XGetRetweetedByParams, XUserListResponse } from '@/tools/x/types'
import { transformUser } from '@/tools/x/types'

const logger = createLogger('XGetRetweetedByTool')

export const xGetRetweetedByTool: ToolConfig<XGetRetweetedByParams, XUserListResponse> = {
  id: 'x_get_retweeted_by',
  name: 'X Get Retweeted By',
  description: 'Get the list of users who retweeted a specific tweet',
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
    tweetId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The tweet ID to get retweeters for',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of results (1-100, default 100)',
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
        'user.fields': 'created_at,description,profile_image_url,verified,public_metrics',
      })

      if (params.maxResults) {
        const max = Math.max(1, Math.min(100, Number(params.maxResults)))
        queryParams.append('max_results', max.toString())
      }
      if (params.paginationToken) queryParams.append('pagination_token', params.paginationToken)

      return `https://api.x.com/2/tweets/${params.tweetId.trim()}/retweeted_by?${queryParams.toString()}`
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
      logger.error('X Get Retweeted By API Error:', JSON.stringify(data, null, 2))
      return {
        success: false,
        error: data.errors?.[0]?.detail || 'No retweeters found or invalid response',
        output: {
          users: [],
          meta: { resultCount: 0, nextToken: null },
        },
      }
    }

    return {
      success: true,
      output: {
        users: data.data.map(transformUser),
        meta: {
          resultCount: data.meta?.result_count ?? data.data.length,
          nextToken: data.meta?.next_token ?? null,
        },
      },
    }
  },

  outputs: {
    users: {
      type: 'array',
      description: 'Array of users who retweeted the tweet',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'User ID' },
          username: { type: 'string', description: 'Username without @ symbol' },
          name: { type: 'string', description: 'Display name' },
          description: { type: 'string', description: 'User bio', optional: true },
          profileImageUrl: { type: 'string', description: 'Profile image URL', optional: true },
          verified: { type: 'boolean', description: 'Whether the user is verified' },
          metrics: {
            type: 'object',
            description: 'User statistics',
            properties: {
              followersCount: { type: 'number', description: 'Number of followers' },
              followingCount: { type: 'number', description: 'Number of users following' },
              tweetCount: { type: 'number', description: 'Total number of tweets' },
            },
          },
        },
      },
    },
    meta: {
      type: 'object',
      description: 'Metadata',
      properties: {
        resultCount: { type: 'number', description: 'Number of results returned' },
        nextToken: { type: 'string', description: 'Token for next page', optional: true },
      },
    },
  },
}
