import type { ToolConfig } from '../types'
import type { XSearchParams, XSearchResponse, XTweet, XUser } from './types'

export const xSearchTool: ToolConfig<XSearchParams, XSearchResponse> = {
  id: 'x_search',
  name: 'X Search',
  description: 'Search for tweets using keywords, hashtags, or advanced queries',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'x',
    additionalScopes: ['tweet.read', 'users.read'],
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
      description: 'Search query (supports X search operators)',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Maximum number of results to return (default: 10, max: 100)',
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
        'tweet.fields': 'created_at,conversation_id,in_reply_to_user_id,attachments',
        'user.fields': 'name,username,description,profile_image_url,verified,public_metrics',
      })

      if (params.maxResults && params.maxResults < 10) {
        queryParams.append('max_results', '10')
      } else if (params.maxResults) {
        queryParams.append('max_results', params.maxResults.toString())
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

    // Check if data.data is undefined/null or not an array
    if (!data.data || !Array.isArray(data.data)) {
      console.error('X Search API Error:', JSON.stringify(data, null, 2))
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

    const transformTweet = (tweet: any): XTweet => ({
      id: tweet.id,
      text: tweet.text,
      createdAt: tweet.created_at,
      authorId: tweet.author_id,
      conversationId: tweet.conversation_id,
      inReplyToUserId: tweet.in_reply_to_user_id,
      attachments: {
        mediaKeys: tweet.attachments?.media_keys,
        pollId: tweet.attachments?.poll_ids?.[0],
      },
    })

    const transformUser = (user: any): XUser => ({
      id: user.id,
      username: user.username,
      name: user.name,
      description: user.description,
      profileImageUrl: user.profile_image_url,
      verified: user.verified,
      metrics: {
        followersCount: user.public_metrics.followers_count,
        followingCount: user.public_metrics.following_count,
        tweetCount: user.public_metrics.tweet_count,
      },
    })

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

  transformError: (error) => {
    // Log the full error object for debugging
    console.error('X Search API Error:', JSON.stringify(error, null, 2))

    if (error.title === 'Unauthorized') {
      return 'Invalid or expired access token. Please reconnect your X account.'
    }
    if (error.title === 'Invalid Request') {
      return 'Invalid search query. Please check your search parameters.'
    }
    if (error.status === 429) {
      return 'Rate limit exceeded. Please try again later.'
    }
    if (error.detail && typeof error.detail === 'string') {
      return `X API error: ${error.detail}`
    }
    return error.detail || error.message || 'An error occurred while searching X'
  },
}
