import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type { XReadParams, XReadResponse, XTweet } from '@/tools/x/types'
import { transformTweet } from '@/tools/x/types'

const logger = createLogger('XReadTool')

export const xReadTool: ToolConfig<XReadParams, XReadResponse> = {
  id: 'x_read',
  name: 'X Read',
  description: 'Read tweet details, including replies and conversation context',
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
      description: 'ID of the tweet to read (e.g., 1234567890123456789)',
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
        'referenced_tweets.id.author_id',
        'attachments.media_keys',
        'attachments.poll_ids',
      ].join(',')

      const tweetFields = [
        'created_at',
        'conversation_id',
        'in_reply_to_user_id',
        'attachments',
        'context_annotations',
        'public_metrics',
      ].join(',')

      const userFields = [
        'name',
        'username',
        'description',
        'profile_image_url',
        'verified',
        'public_metrics',
      ].join(',')

      const queryParams = new URLSearchParams({
        expansions,
        'tweet.fields': tweetFields,
        'user.fields': userFields,
      })

      return `https://api.twitter.com/2/tweets/${params.tweetId}?${queryParams.toString()}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response, params) => {
    const data = await response.json()

    if (data.errors && !data.data) {
      logger.error('X Read API Error:', JSON.stringify(data, null, 2))
      return {
        success: false,
        error: data.errors?.[0]?.detail || data.errors?.[0]?.message || 'Failed to fetch tweet',
        output: {
          tweet: {} as XTweet,
        },
      }
    }

    const mainTweet = transformTweet(data.data)
    const context: { parentTweet?: XTweet; rootTweet?: XTweet } = {}

    if (data.includes?.tweets) {
      const referencedTweets = data.data.referenced_tweets || []
      const parentTweetRef = referencedTweets.find((ref: any) => ref.type === 'replied_to')
      const quotedTweetRef = referencedTweets.find((ref: any) => ref.type === 'quoted')

      if (parentTweetRef) {
        const parentTweet = data.includes.tweets.find((t: any) => t.id === parentTweetRef.id)
        if (parentTweet) context.parentTweet = transformTweet(parentTweet)
      }

      if (!parentTweetRef && quotedTweetRef) {
        const quotedTweet = data.includes.tweets.find((t: any) => t.id === quotedTweetRef.id)
        if (quotedTweet) context.rootTweet = transformTweet(quotedTweet)
      }
    }

    let replies: XTweet[] = []
    if (params?.includeReplies && mainTweet.id) {
      try {
        const repliesExpansions = ['author_id', 'referenced_tweets.id'].join(',')
        const repliesTweetFields = [
          'created_at',
          'conversation_id',
          'in_reply_to_user_id',
          'public_metrics',
        ].join(',')

        const conversationId = mainTweet.conversationId || mainTweet.id
        const searchQuery = `conversation_id:${conversationId}`
        const searchParams = new URLSearchParams({
          query: searchQuery,
          expansions: repliesExpansions,
          'tweet.fields': repliesTweetFields,
          max_results: '100', // Max allowed
        })

        const repliesResponse = await fetch(
          `https://api.twitter.com/2/tweets/search/recent?${searchParams.toString()}`,
          {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${params?.accessToken || ''}`,
              'Content-Type': 'application/json',
            },
          }
        )

        const repliesData = await repliesResponse.json()

        if (repliesData.data && Array.isArray(repliesData.data)) {
          replies = repliesData.data
            .filter((tweet: any) => tweet.id !== mainTweet.id)
            .map(transformTweet)
        }
      } catch (error) {
        logger.warn('Failed to fetch replies:', error)
      }
    }

    return {
      success: true,
      output: {
        tweet: mainTweet,
        replies: replies.length > 0 ? replies : undefined,
        context: Object.keys(context).length > 0 ? context : undefined,
      },
    }
  },

  outputs: {
    tweet: {
      type: 'object',
      description: 'The main tweet data',
      properties: {
        id: { type: 'string', description: 'Tweet ID' },
        text: { type: 'string', description: 'Tweet content text' },
        createdAt: { type: 'string', description: 'Tweet creation timestamp' },
        authorId: { type: 'string', description: 'ID of the tweet author' },
      },
    },
    context: {
      type: 'object',
      description: 'Conversation context including parent and root tweets',
      optional: true,
    },
  },
}
