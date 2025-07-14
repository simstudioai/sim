import type { ToolConfig } from '../types'
import type { XReadParams, XReadResponse, XTweet } from './types'

export const xReadTool: ToolConfig<XReadParams, XReadResponse> = {
  id: 'x_read',
  name: 'X Read',
  description: 'Read tweet details, including replies and conversation context',
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
    tweetId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'ID of the tweet to read',
    },
    includeReplies: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Whether to include replies to the tweet',
    },
  },

  request: {
    url: (params) => {
      const expansions = [
        'author_id',
        'in_reply_to_user_id',
        'referenced_tweets.id',
        'attachments.media_keys',
        'attachments.poll_ids',
      ].join(',')

      return `https://api.twitter.com/2/tweets/${params.tweetId}?expansions=${expansions}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
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

    const mainTweet = transformTweet(data.data)
    const context: { parentTweet?: XTweet; rootTweet?: XTweet } = {}

    // Get parent and root tweets if available
    if (data.includes?.tweets) {
      const referencedTweets = data.data.referenced_tweets || []
      const parentTweetRef = referencedTweets.find((ref: any) => ref.type === 'replied_to')
      const rootTweetRef = referencedTweets.find((ref: any) => ref.type === 'replied_to_root')

      if (parentTweetRef) {
        const parentTweet = data.includes.tweets.find((t: any) => t.id === parentTweetRef.id)
        if (parentTweet) context.parentTweet = transformTweet(parentTweet)
      }

      if (rootTweetRef) {
        const rootTweet = data.includes.tweets.find((t: any) => t.id === rootTweetRef.id)
        if (rootTweet) context.rootTweet = transformTweet(rootTweet)
      }
    }

    return {
      success: true,
      output: {
        tweet: mainTweet,
        context,
      },
    }
  },

  transformError: (error) => {
    if (error.title === 'Unauthorized') {
      return 'Invalid or expired access token. Please reconnect your X account.'
    }
    if (error.title === 'Not Found') {
      return 'The specified tweet was not found.'
    }
    return error.detail || 'An unexpected error occurred while reading from X'
  },
}
