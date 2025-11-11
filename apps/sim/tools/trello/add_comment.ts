import { env } from '@/lib/env'
import type { TrelloAddCommentParams, TrelloAddCommentResponse } from '@/tools/trello/types'
import type { ToolConfig } from '@/tools/types'

export const trelloAddCommentTool: ToolConfig<TrelloAddCommentParams, TrelloAddCommentResponse> = {
  id: 'trello_add_comment',
  name: 'Trello Add Comment',
  description: 'Add a comment to a Trello card',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'trello',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Trello OAuth access token',
    },
    cardId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the card to comment on',
    },
    text: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comment text',
    },
  },

  request: {
    url: (params) => {
      if (!params.cardId) {
        throw new Error('Card ID is required')
      }
      const apiKey = env.TRELLO_API_KEY || ''
      const token = params.accessToken
      return `https://api.trello.com/1/cards/${params.cardId}/actions/comments?key=${apiKey}&token=${token}`
    },
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }),
    body: (params) => {
      if (!params.text) {
        throw new Error('Comment text is required')
      }

      return {
        text: params.text,
      }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!data?.id) {
      return {
        success: false,
        output: {
          error: data?.message || 'Failed to add comment',
        },
        error: data?.message || 'Failed to add comment',
      }
    }

    return {
      success: true,
      output: {
        comment: {
          id: data.id,
          text: data.data?.text,
          date: data.date,
          memberCreator: data.memberCreator,
        },
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the comment was added successfully' },
    comment: {
      type: 'object',
      description: 'The created comment object with id, text, date, and member creator',
    },
    error: { type: 'string', description: 'Error message if operation failed' },
  },
}
