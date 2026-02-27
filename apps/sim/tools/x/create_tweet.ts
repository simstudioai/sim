import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type { XCreateTweetParams, XCreateTweetResponse } from '@/tools/x/types'

const logger = createLogger('XCreateTweetTool')

export const xCreateTweetTool: ToolConfig<XCreateTweetParams, XCreateTweetResponse> = {
  id: 'x_create_tweet',
  name: 'X Create Tweet',
  description: 'Create a new tweet, reply, or quote tweet on X',
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
    text: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The text content of the tweet (max 280 characters)',
    },
    replyToTweetId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Tweet ID to reply to',
    },
    quoteTweetId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Tweet ID to quote',
    },
    mediaIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated media IDs to attach (up to 4)',
    },
    replySettings: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Who can reply: "mentionedUsers", "following", "subscribers", or "verified"',
    },
  },

  request: {
    url: 'https://api.x.com/2/tweets',
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        text: params.text,
      }

      if (params.replyToTweetId) {
        body.reply = { in_reply_to_tweet_id: params.replyToTweetId.trim() }
      }

      if (params.quoteTweetId) {
        body.quote_tweet_id = params.quoteTweetId.trim()
      }

      if (params.mediaIds) {
        const ids = params.mediaIds
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean)
        if (ids.length > 0) {
          body.media = { media_ids: ids }
        }
      }

      if (params.replySettings) {
        body.reply_settings = params.replySettings
      }

      return body
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!data.data) {
      logger.error('X Create Tweet API Error:', JSON.stringify(data, null, 2))
      return {
        success: false,
        error: data.errors?.[0]?.detail || 'Failed to create tweet',
        output: {
          id: '',
          text: '',
        },
      }
    }

    return {
      success: true,
      output: {
        id: data.data.id ?? '',
        text: data.data.text ?? '',
      },
    }
  },

  outputs: {
    id: {
      type: 'string',
      description: 'The ID of the created tweet',
    },
    text: {
      type: 'string',
      description: 'The text of the created tweet',
    },
  },
}
