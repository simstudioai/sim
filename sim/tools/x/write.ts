import { ToolConfig } from '../types'
import { XWriteParams, XWriteResponse } from './types'

export const writeTool: ToolConfig<XWriteParams, XWriteResponse> = {
  id: 'x_write',
  name: 'X Write',
  description: 'Post new tweets, reply to tweets, or create polls on X (Twitter)',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      requiredForToolCall: true,
      description: 'X API Bearer token',
    },
    text: {
      type: 'string',
      required: true,
      description: 'The text content of your tweet',
    },
    replyTo: {
      type: 'string',
      required: false,
      description: 'ID of the tweet to reply to',
    },
    mediaIds: {
      type: 'array',
      required: false,
      description: 'Array of media IDs to attach to the tweet',
    },
    poll: {
      type: 'object',
      required: false,
      description: 'Poll configuration for the tweet',
    },
  },

  request: {
    url: 'https://api.x.com/2/tweets',
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
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
      return 'Invalid Bearer token. Please check your credentials or token scopes.'
    }
    if (error.title === 'Not Found') {
      return 'The specified tweet or resource was not found.'
    }
    return error.detail || 'An unexpected error occurred while posting to X'
  },
}
