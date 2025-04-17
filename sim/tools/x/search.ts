import { ToolConfig } from '../types'
import { XSearchParams, XSearchResponse, XTweet, XUser } from './types'

export const searchTool: ToolConfig<XSearchParams, XSearchResponse> = {
  id: 'x_search',
  name: 'X Search',
  description: 'Search for tweets using keywords, hashtags, or advanced queries',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      requiredForToolCall: true,
      description: 'X API key for authentication',
    },
    query: {
      type: 'string',
      required: true,
      description: 'Search query (supports X search operators)',
    },
    maxResults: {
      type: 'number',
      required: false,
      description: 'Maximum number of results to return (default: 10, max: 100)',
    },
    startTime: {
      type: 'string',
      required: false,
      description: 'Start time for search (ISO 8601 format)',
    },
    endTime: {
      type: 'string',
      required: false,
      description: 'End time for search (ISO 8601 format)',
    },
    sortOrder: {
      type: 'string',
      required: false,
      description: 'Sort order for results (recency or relevancy)',
    },
  },

  request: {
    url: (params) => {
      const query = encodeURIComponent(params.query)
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

      if (params.maxResults) queryParams.append('max_results', params.maxResults.toString())
      if (params.startTime) queryParams.append('start_time', params.startTime)
      if (params.endTime) queryParams.append('end_time', params.endTime)
      if (params.sortOrder) queryParams.append('sort_order', params.sortOrder)

      return `https://api.x.com/2/tweets/search/recent?${queryParams.toString()}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

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
    if (error.title === 'Unauthorized') {
      return 'Invalid API key. Please check your credentials.'
    }
    if (error.title === 'Invalid Request') {
      return 'Invalid search query. Please check your search parameters.'
    }
    return error.detail || 'An unexpected error occurred while searching X'
  },
}
