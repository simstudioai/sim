import { getErrorMessage } from '@sim/utils/errors'
import { isRecordLike } from '@sim/utils/object'
import { env } from '@/lib/core/config/env'
import {
  extractTrelloErrorMessage,
  mapTrelloBoard,
  mapTrelloCard,
  TRELLO_API_BASE_URL,
} from '@/tools/trello/shared'
import type { TrelloSearchParams, TrelloSearchResponse } from '@/tools/trello/types'
import type { ToolConfig } from '@/tools/types'

export const trelloSearchTool: ToolConfig<TrelloSearchParams, TrelloSearchResponse> = {
  id: 'trello_search',
  name: 'Trello Search',
  description: 'Search Trello cards and boards by keyword',
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
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Search text, supports Trello search operators (e.g. board:, list:, due:)',
    },
    idBoards: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Restrict the search to these board IDs',
      items: {
        type: 'string',
        description: 'A Trello board ID',
      },
    },
    modelTypes: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated result types to search: cards, boards, or all (default all)',
    },
    cardsLimit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of cards to return (1-1000, default 10)',
    },
  },

  request: {
    url: (params) => {
      if (!params.query) {
        throw new Error('Search query is required')
      }
      const apiKey = env.TRELLO_API_KEY

      if (!apiKey) {
        throw new Error('TRELLO_API_KEY environment variable is not set')
      }

      const url = new URL(`${TRELLO_API_BASE_URL}/search`)
      url.searchParams.set('key', apiKey)
      url.searchParams.set('token', params.accessToken)
      url.searchParams.set('query', params.query)
      url.searchParams.set('modelTypes', params.modelTypes || 'all')

      if (params.idBoards?.length) {
        url.searchParams.set('idBoards', params.idBoards.join(','))
      }

      if (params.cardsLimit !== undefined) {
        url.searchParams.set('cards_limit', String(params.cardsLimit))
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
      const error = extractTrelloErrorMessage(response, data, 'Failed to search Trello')

      return {
        success: false,
        output: {
          cards: [],
          boards: [],
          count: 0,
          error,
        },
        error,
      }
    }

    if (!isRecordLike(data)) {
      const error = 'Trello returned an invalid search result'

      return {
        success: false,
        output: {
          cards: [],
          boards: [],
          count: 0,
          error,
        },
        error,
      }
    }

    try {
      const rawCards = Array.isArray(data.cards) ? data.cards : []
      const rawBoards = Array.isArray(data.boards) ? data.boards : []
      const cards = rawCards.map((item) => mapTrelloCard(item))
      const boards = rawBoards.map((item) => mapTrelloBoard(item))

      return {
        success: true,
        output: {
          cards,
          boards,
          count: cards.length + boards.length,
        },
      }
    } catch (error) {
      const message = getErrorMessage(error, 'Failed to parse Trello search results')

      return {
        success: false,
        output: {
          cards: [],
          boards: [],
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
      description: 'Cards matching the search query',
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
        },
      },
    },
    boards: {
      type: 'array',
      description: 'Boards matching the search query',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Board ID' },
          name: { type: 'string', description: 'Board name' },
          desc: { type: 'string', description: 'Board description' },
          url: { type: 'string', description: 'Full board URL' },
          closed: { type: 'boolean', description: 'Whether the board is archived' },
          idOrganization: {
            type: 'string',
            description: 'Workspace/organization ID that owns the board',
            optional: true,
          },
        },
      },
    },
    count: { type: 'number', description: 'Total number of cards and boards returned' },
  },
}
