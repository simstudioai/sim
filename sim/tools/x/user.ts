import { ToolConfig } from '../types'
import { XTweet, XUser, XUserParams, XUserResponse } from './types'

export const userTool: ToolConfig<XUserParams, XUserResponse> = {
  id: 'x_user',
  name: 'X User',
  description: 'Get user profile information and recent tweets',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      requiredForToolCall: true,
      description: 'X API key for authentication',
    },
    username: {
      type: 'string',
      required: true,
      description: 'Username to look up (without @ symbol)',
    },
    includeRecentTweets: {
      type: 'boolean',
      required: false,
      description: 'Whether to include recent tweets from the user',
    },
  },

  request: {
    url: (params) => {
      const username = encodeURIComponent(params.username)
      const userFields = ['description', 'profile_image_url', 'verified', 'public_metrics'].join(
        ','
      )

      return `https://api.x.com/2/users/by/username/${username}?user.fields=${userFields}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    const requestUrl = new URL(response.url)
    const apiKey = response.headers.get('Authorization')?.split(' ')[1] || ''

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

    const user = transformUser(data.data)
    let recentTweets: XTweet[] | undefined

    // Check if includeRecentTweets was in the original request
    const includeRecentTweets = requestUrl.searchParams.get('include_tweets') === 'true'

    // Fetch recent tweets if requested
    if (includeRecentTweets && apiKey) {
      const tweetsResponse = await fetch(
        `https://api.x.com/2/users/${user.id}/tweets?max_results=10&tweet.fields=created_at,conversation_id,in_reply_to_user_id,attachments`,
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
        }
      )
      const tweetsData = await tweetsResponse.json()
      recentTweets = tweetsData.data.map(transformTweet)
    }

    return {
      success: true,
      output: {
        user,
        recentTweets,
      },
    }
  },

  transformError: (error) => {
    if (error.title === 'Unauthorized') {
      return 'Invalid API key. Please check your credentials.'
    }
    if (error.title === 'Not Found') {
      return 'The specified user was not found.'
    }
    return error.detail || 'An unexpected error occurred while fetching user data from X'
  },
}
