import type { ToolConfig } from '../types'
import type { XWriteParams, XWriteResponse } from './types'

export const xWriteTool: ToolConfig<XWriteParams, XWriteResponse> = {
  id: 'x_write',
  name: 'X Write',
  description: 'Post new tweets, reply to tweets, or create polls on X (Twitter)',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'x',
    additionalScopes: ['tweet.read', 'tweet.write', 'users.read'],
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'X OAuth access token',
    },
    text: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The text content of your tweet',
    },
    replyTo: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'ID of the tweet to reply to',
    },
    mediaIds: {
      type: 'array',
      required: false,
      visibility: 'user-only',
      description: 'Array of media IDs to attach to the tweet',
    },
    poll: {
      type: 'object',
      required: false,
      visibility: 'user-only',
      description: 'Poll configuration for the tweet',
    },
  },

  request: {
    url: 'https://api.twitter.com/2/tweets',
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: any = {
        text: params.text,
      }

      if (params.replyTo) {
        body.reply = { in_reply_to_tweet_id: params.replyTo }
      }

      if (params.mediaIds?.length) {
        body.media = { media_ids: params.mediaIds }
      }

      if (params.poll) {
        body.poll = {
          options: params.poll.options,
          duration_minutes: params.poll.durationMinutes,
        }
      }

      return body
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        tweet: {
          id: data.data.id,
          text: data.data.text,
          createdAt: data.data.created_at,
          authorId: data.data.author_id,
          conversationId: data.data.conversation_id,
          inReplyToUserId: data.data.in_reply_to_user_id,
          attachments: {
            mediaKeys: data.data.attachments?.media_keys,
            pollId: data.data.attachments?.poll_ids?.[0],
          },
        },
      },
    }
  },

  transformError: (error) => {
    if (error.title === 'Unauthorized') {
      return 'Invalid or expired access token. Please reconnect your X account.'
    }
    if (error.title === 'Forbidden') {
      return 'You do not have permission to post tweets. Ensure your X app has tweet.write scope.'
    }
    return error.detail || 'An unexpected error occurred while posting to X'
  },
}
