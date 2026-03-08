import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type { XGetUserTimelineParams, XTweetListResponse } from '@/tools/x/types'
import { transformTweet, transformUser } from '@/tools/x/types'

const logger = createLogger('XGetUserTimelineTool')

export const xGetUserTimelineTool: ToolConfig<XGetUserTimelineParams, XTweetListResponse> = {
  id: 'x_get_user_timeline',
  name: 'X Get User Timeline',
  description: 'Get the reverse chronological home timeline for the authenticated user',
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
      description: 'The authenticated user ID',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of results (1-100, default 10)',
    },
    paginationToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination token for next page of results',
    },
    startTime: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Oldest UTC timestamp in ISO 8601 format',
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
    exclude: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated types to exclude: "retweets", "replies"',
    },
  },

  request: {
    url: (params) => {
      const queryParams = new URLSearchParams({
        expansions: 'author_id,referenced_tweets.id,attachments.media_keys,attachments.poll_ids',
        'tweet.fields':
          'created_at,conversation_id,in_reply_to_user_id,attachments,context_annotations,public_metrics',
        'user.fields': 'name,username,description,profile_image_url,verified,public_metrics',
      })

      if (params.maxResults) {
        const max = Math.max(1, Math.min(100, Number(params.maxResults)))
        queryParams.append('max_results', max.toString())
      }
      if (params.paginationToken) queryParams.append('pagination_token', params.paginationToken)
      if (params.startTime) queryParams.append('start_time', params.startTime)
      if (params.endTime) queryParams.append('end_time', params.endTime)
      if (params.sinceId) queryParams.append('since_id', params.sinceId)
      if (params.untilId) queryParams.append('until_id', params.untilId)
      if (params.exclude) queryParams.append('exclude', params.exclude)

      return `https://api.x.com/2/users/${params.userId.trim()}/timelines/reverse_chronological?${queryParams.toString()}`
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
      logger.error('X Get User Timeline API Error:', JSON.stringify(data, null, 2))
      return {
        success: false,
        error: data.errors?.[0]?.detail || 'No timeline data found or invalid response',
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
      description: 'Array of timeline tweets',
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
      description: 'Pagination metadata',
      properties: {
        resultCount: { type: 'number', description: 'Number of results returned' },
        newestId: { type: 'string', description: 'ID of the newest tweet', optional: true },
        oldestId: { type: 'string', description: 'ID of the oldest tweet', optional: true },
        nextToken: { type: 'string', description: 'Token for next page', optional: true },
        previousToken: { type: 'string', description: 'Token for previous page', optional: true },
      },
    },
  },
}
