import { env } from '@/lib/core/config/env'
import {
  extractTrelloErrorMessage,
  mapTrelloComment,
  TRELLO_API_BASE_URL,
} from '@/tools/trello/shared'
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
      description: 'Trello card ID (24-character hex string)',
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
      if (!params.text) {
        throw new Error('Comment text is required')
      }
      const apiKey = env.TRELLO_API_KEY

      if (!apiKey) {
        throw new Error('TRELLO_API_KEY environment variable is not set')
      }

      const url = new URL(`${TRELLO_API_BASE_URL}/cards/${params.cardId.trim()}/actions/comments`)
      url.searchParams.set('key', apiKey)
      url.searchParams.set('token', params.accessToken)
      url.searchParams.set('text', params.text)

      return url.toString()
    },
    method: 'POST',
    headers: () => ({
      Accept: 'application/json',
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json().catch(() => null)

    if (!response.ok) {
      const error = extractTrelloErrorMessage(response, data, 'Failed to add comment')

      return {
        success: false,
        output: {
          error,
        },
        error,
      }
    }

    try {
      const comment = mapTrelloComment(data)

      return {
        success: true,
        output: {
          comment,
        },
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to parse created comment'

      return {
        success: false,
        output: {
          error: message,
        },
        error: message,
      }
    }
  },

  outputs: {
    comment: {
      type: 'json',
      description:
        'Created comment action (id, type, date, idMemberCreator, text, memberCreator, card, board, list)',
      optional: true,
      properties: {
        id: { type: 'string', description: 'Action ID' },
        type: { type: 'string', description: 'Action type' },
        date: { type: 'string', description: 'Action timestamp' },
        idMemberCreator: {
          type: 'string',
          description: 'ID of the member who created the comment',
        },
        text: {
          type: 'string',
          description: 'Comment text',
          optional: true,
        },
        memberCreator: {
          type: 'object',
          description: 'Member who created the comment',
          optional: true,
          properties: {
            id: { type: 'string', description: 'Member ID' },
            fullName: {
              type: 'string',
              description: 'Member full name',
              optional: true,
            },
            username: {
              type: 'string',
              description: 'Member username',
              optional: true,
            },
          },
        },
        card: {
          type: 'object',
          description: 'Card referenced by the comment',
          optional: true,
          properties: {
            id: { type: 'string', description: 'Card ID' },
            name: { type: 'string', description: 'Card name' },
            shortLink: {
              type: 'string',
              description: 'Short card link',
              optional: true,
            },
            idShort: {
              type: 'number',
              description: 'Board-local card number',
              optional: true,
            },
            due: {
              type: 'string',
              description: 'Card due date',
              optional: true,
            },
          },
        },
        board: {
          type: 'object',
          description: 'Board referenced by the comment',
          optional: true,
          properties: {
            id: { type: 'string', description: 'Board ID' },
            name: { type: 'string', description: 'Board name' },
            shortLink: {
              type: 'string',
              description: 'Short board link',
              optional: true,
            },
          },
        },
        list: {
          type: 'object',
          description: 'List referenced by the comment',
          optional: true,
          properties: {
            id: { type: 'string', description: 'List ID' },
            name: { type: 'string', description: 'List name' },
          },
        },
      },
    },
  },
}
