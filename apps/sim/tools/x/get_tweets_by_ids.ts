import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type { XGetTweetsByIdsParams, XGetTweetsByIdsResponse } from '@/tools/x/types'
import { transformTweet, transformUser } from '@/tools/x/types'

const logger = createLogger('XGetTweetsByIdsTool')

export const xGetTweetsByIdsTool: ToolConfig<XGetTweetsByIdsParams, XGetTweetsByIdsResponse> = {
  id: 'x_get_tweets_by_ids',
  name: 'X Get Tweets By IDs',
  description: 'Look up multiple tweets by their IDs (up to 100)',
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
    ids: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comma-separated tweet IDs (up to 100)',
    },
  },

  request: {
    url: (params) => {
      const queryParams = new URLSearchParams({
        ids: params.ids.trim(),
        expansions: 'author_id,referenced_tweets.id,attachments.media_keys,attachments.poll_ids',
        'tweet.fields':
          'created_at,conversation_id,in_reply_to_user_id,attachments,context_annotations,public_metrics',
        'user.fields': 'name,username,description,profile_image_url,verified,public_metrics',
      })

      return `https://api.x.com/2/tweets?${queryParams.toString()}`
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
      logger.error('X Get Tweets By IDs API Error:', JSON.stringify(data, null, 2))
      return {
        success: false,
        error: data.errors?.[0]?.detail || 'No tweets found or invalid response',
        output: {
          tweets: [],
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
      },
    }
  },

  outputs: {
    tweets: {
      type: 'array',
      description: 'Array of tweets matching the provided IDs',
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
  },
}
