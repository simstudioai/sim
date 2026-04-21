import { env } from '@/lib/core/config/env'
import {
  extractTrelloErrorMessage,
  mapTrelloCard,
  TRELLO_API_BASE_URL,
} from '@/tools/trello/shared'
import type { TrelloListCardsParams, TrelloListCardsResponse } from '@/tools/trello/types'
import type { ToolConfig } from '@/tools/types'

export const trelloListCardsTool: ToolConfig<TrelloListCardsParams, TrelloListCardsResponse> = {
  id: 'trello_list_cards',
  name: 'Trello List Cards',
  description: 'List cards from a Trello board or list',
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
      description: 'Trello board ID to list open cards from. Provide either boardId or listId',
    },
    listId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Trello list ID to list cards from. Provide either boardId or listId',
    },
  },

  request: {
    url: (params) => {
      const apiKey = env.TRELLO_API_KEY

      if (!apiKey) {
        throw new Error('TRELLO_API_KEY environment variable is not set')
      }

      if (params.boardId && params.listId) {
        throw new Error('Provide either a board ID or list ID, not both')
      }

      if (!params.listId && !params.boardId) {
        throw new Error('Either a board ID or list ID is required')
      }

      const path = params.listId
        ? `/lists/${params.listId.trim()}/cards`
        : `/boards/${params.boardId?.trim()}/cards`
      const url = new URL(`${TRELLO_API_BASE_URL}${path}`)
      url.searchParams.set('key', apiKey)
      url.searchParams.set('token', params.accessToken)

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
      const error = extractTrelloErrorMessage(response, data, 'Failed to list Trello cards')

      return {
        success: false,
        output: {
          cards: [],
          count: 0,
          error,
        },
        error,
      }
    }

    if (!Array.isArray(data)) {
      const error = 'Trello returned an invalid card collection'

      return {
        success: false,
        output: {
          cards: [],
          count: 0,
          error,
        },
        error,
      }
    }

    try {
      const cards = data.map((item) => mapTrelloCard(item))

      return {
        success: true,
        output: {
          cards,
          count: cards.length,
        },
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to parse Trello cards'

      return {
        success: false,
        output: {
          cards: [],
          count: 0,
          error: message,
        },
        error: message,
      }
    }
  },

  outputs: {
    cards: {
      type: 'array',
      description: 'Cards returned from the selected Trello board or list',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Card ID' },
          name: { type: 'string', description: 'Card name' },
          desc: { type: 'string', description: 'Card description' },
          url: { type: 'string', description: 'Full card URL' },
          idBoard: { type: 'string', description: 'Board ID containing the card' },
          idList: { type: 'string', description: 'List ID containing the card' },
          closed: { type: 'boolean', description: 'Whether the card is archived' },
          labelIds: {
            type: 'array',
            description: 'Label IDs applied to the card',
            items: {
              type: 'string',
              description: 'A Trello label ID',
            },
          },
          labels: {
            type: 'array',
            description: 'Labels applied to the card',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Label ID' },
                name: { type: 'string', description: 'Label name' },
                color: {
                  type: 'string',
                  description: 'Label color',
                  optional: true,
                },
              },
            },
          },
          due: {
            type: 'string',
            description: 'Card due date in ISO 8601 format',
            optional: true,
          },
          dueComplete: {
            type: 'boolean',
            description: 'Whether the due date is complete',
            optional: true,
          },
        },
      },
    },
    count: { type: 'number', description: 'Number of cards returned' },
  },
}
