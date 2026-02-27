import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type { XSearchTweetsParams, XTweet, XUser } from '@/tools/x/types'
import { transformTweet, transformUser } from '@/tools/x/types'

const logger = createLogger('XSearchTweetsTool')

interface XSearchTweetsResponse {
  success: boolean
  output: {
    tweets: XTweet[]
    includes?: { users: XUser[] }
    meta: {
      resultCount: number
      newestId: string | null
      oldestId: string | null
      nextToken: string | null
    }
  }
}

export const xSearchTweetsTool: ToolConfig<XSearchTweetsParams, XSearchTweetsResponse> = {
  id: 'x_search_tweets',
  name: 'X Search Tweets',
  description: 'Search for recent tweets using keywords, hashtags, or advanced query operators',
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
        'Search query (supports operators like "from:", "to:", "#hashtag", "has:images", "is:retweet", "lang:")',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of results (10-100, default 10)',
    },
    startTime: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Oldest UTC timestamp in ISO 8601 format (e.g., 2024-01-01T00:00:00Z)',
    },
    endTime: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Newest UTC timestamp in ISO 8601 format',
    },
    sinceId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Returns tweets with ID greater than this',
    },
    untilId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Returns tweets with ID less than this',
    },
    sortOrder: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort order: "recency" or "relevancy"',
    },
    nextToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination token for next page of results',
    },
  },

  request: {
    url: (params) => {
      const queryParams = new URLSearchParams({
        query: params.query,
        expansions: 'author_id,referenced_tweets.id,attachments.media_keys,attachments.poll_ids',
        'tweet.fields':
          'created_at,conversation_id,in_reply_to_user_id,attachments,context_annotations,public_metrics',
        'user.fields': 'name,username,description,profile_image_url,verified,public_metrics',
      })

      if (params.maxResults) {
        const max = Math.max(10, Math.min(100, Number(params.maxResults)))
        queryParams.append('max_results', max.toString())
      }
      if (params.startTime) queryParams.append('start_time', params.startTime)
      if (params.endTime) queryParams.append('end_time', params.endTime)
      if (params.sinceId) queryParams.append('since_id', params.sinceId)
      if (params.untilId) queryParams.append('until_id', params.untilId)
      if (params.sortOrder) queryParams.append('sort_order', params.sortOrder)
      if (params.nextToken) queryParams.append('next_token', params.nextToken)

      return `https://api.x.com/2/tweets/search/recent?${queryParams.toString()}`
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
      logger.error('X Search Tweets API Error:', JSON.stringify(data, null, 2))
      return {
        success: false,
        error:
          data.errors?.[0]?.detail ||
          data.errors?.[0]?.title ||
          'No results found or invalid response from X API',
        output: {
          tweets: [],
          includes: { users: [] },
          meta: {
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
          users: data.includes?.users?.map(transformUser) ?? [],
        },
        meta: {
          resultCount: data.meta?.result_count ?? 0,
          newestId: data.meta?.newest_id ?? null,
          oldestId: data.meta?.oldest_id ?? null,
          nextToken: data.meta?.next_token ?? null,
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
          text: { type: 'string', description: 'Tweet text content' },
          createdAt: { type: 'string', description: 'Tweet creation timestamp' },
          authorId: { type: 'string', description: 'Author user ID' },
          conversationId: { type: 'string', description: 'Conversation thread ID', optional: true },
          inReplyToUserId: {
            type: 'string',
            description: 'User ID being replied to',
            optional: true,
          },
          publicMetrics: {
            type: 'object',
            description: 'Engagement metrics',
            optional: true,
            properties: {
              retweetCount: { type: 'number', description: 'Number of retweets' },
              replyCount: { type: 'number', description: 'Number of replies' },
              likeCount: { type: 'number', description: 'Number of likes' },
              quoteCount: { type: 'number', description: 'Number of quotes' },
            },
          },
        },
      },
    },
    includes: {
      type: 'object',
      description: 'Additional data including user profiles',
      optional: true,
      properties: {
        users: {
          type: 'array',
          description: 'Array of user objects referenced in tweets',
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
      },
    },
    meta: {
      type: 'object',
      description: 'Search metadata including result count and pagination tokens',
      properties: {
        resultCount: { type: 'number', description: 'Number of results returned' },
        newestId: { type: 'string', description: 'ID of the newest tweet', optional: true },
        oldestId: { type: 'string', description: 'ID of the oldest tweet', optional: true },
        nextToken: {
          type: 'string',
          description: 'Pagination token for next page',
          optional: true,
        },
      },
    },
  },
}
