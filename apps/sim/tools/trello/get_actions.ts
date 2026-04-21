import { env } from '@/lib/core/config/env'
import {
  extractTrelloErrorMessage,
  mapTrelloAction,
  TRELLO_API_BASE_URL,
} from '@/tools/trello/shared'
import type { TrelloGetActionsParams, TrelloGetActionsResponse } from '@/tools/trello/types'
import type { ToolConfig } from '@/tools/types'

export const trelloGetActionsTool: ToolConfig<TrelloGetActionsParams, TrelloGetActionsResponse> = {
  id: 'trello_get_actions',
  name: 'Trello Get Actions',
  description: 'Get activity/actions from a board or card',
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
    boardId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Trello board ID (24-character hex string). Either boardId or cardId required',
    },
    cardId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Trello card ID (24-character hex string). Either boardId or cardId required',
    },
    filter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter actions by type (e.g., "commentCard,updateCard,createCard" or "all")',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of board actions to return',
    },
    page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page number for action results',
    },
  },

  request: {
    url: (params) => {
      if (!params.boardId && !params.cardId) {
        throw new Error('Either boardId or cardId is required')
      }
      if (params.boardId && params.cardId) {
        throw new Error('Provide either boardId or cardId, not both')
      }

      const apiKey = env.TRELLO_API_KEY

      if (!apiKey) {
        throw new Error('TRELLO_API_KEY environment variable is not set')
      }

      const path = params.boardId
        ? `/boards/${params.boardId.trim()}/actions`
        : `/cards/${params.cardId?.trim()}/actions`
      const url = new URL(`${TRELLO_API_BASE_URL}${path}`)
      url.searchParams.set('key', apiKey)
      url.searchParams.set('token', params.accessToken)

      if (params.filter) {
        url.searchParams.set('filter', params.filter)
      }

      if (params.boardId && params.limit !== undefined) {
        url.searchParams.set('limit', String(params.limit))
      }

      if (params.page !== undefined) {
        url.searchParams.set('page', String(params.page))
      }

      return url.toString()
    },
    method: 'GET',
    headers: () => ({
      Accept: 'application/json',
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json().catch(() => null)

    if (!response.ok) {
      const error = extractTrelloErrorMessage(response, data, 'Failed to get Trello actions')

      return {
        success: false,
        output: {
          actions: [],
          count: 0,
          error,
        },
        error,
      }
    }

    if (!Array.isArray(data)) {
      const error = 'Trello returned an invalid action collection'

      return {
        success: false,
        output: {
          actions: [],
          count: 0,
          error,
        },
        error,
      }
    }

    try {
      const actions = data.map((item) => mapTrelloAction(item))

      return {
        success: true,
        output: {
          actions,
          count: actions.length,
        },
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to parse Trello actions'

      return {
        success: false,
        output: {
          actions: [],
          count: 0,
          error: message,
        },
        error: message,
      }
    }
  },

  outputs: {
    actions: {
      type: 'array',
      description:
        'Action items (id, type, date, idMemberCreator, text, memberCreator, card, board, list)',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Action ID' },
          type: { type: 'string', description: 'Action type' },
          date: { type: 'string', description: 'Action timestamp' },
          idMemberCreator: {
            type: 'string',
            description: 'ID of the member who created the action',
          },
          text: {
            type: 'string',
            description: 'Comment text when present',
            optional: true,
          },
          memberCreator: {
            type: 'object',
            description: 'Member who created the action',
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
            description: 'Card referenced by the action',
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
            description: 'Board referenced by the action',
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
            description: 'List referenced by the action',
            optional: true,
            properties: {
              id: { type: 'string', description: 'List ID' },
              name: { type: 'string', description: 'List name' },
            },
          },
        },
      },
    },
    count: { type: 'number', description: 'Number of actions returned' },
  },
}
