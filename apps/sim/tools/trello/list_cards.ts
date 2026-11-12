import { getErrorMessage } from '@sim/utils/errors'
import { env } from '@/lib/core/config/env'
import {
  extractTrelloErrorMessage,
  mapTrelloCard,
  TRELLO_API_BASE_URL,
} from '@/tools/trello/shared'
import type { TrelloListCardsParams, TrelloListCardsResponse } from '@/tools/trello/types'
import { TRELLO_CARD_OUTPUT_PROPERTIES } from '@/tools/trello/types'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

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
    filter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Which cards to return: open, closed, or all (defaults to open)',
    },
    since: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return cards created since this date (ISO 8601) or card ID',
    },
    before: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return cards created before this date (ISO 8601) or card ID',
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
        ? `/lists/${safeUrlPathSegment(params.listId, 'listId')}/cards`
        : `/boards/${safeUrlPathSegment(params.boardId ?? '', 'boardId')}/cards`
      const url = new URL(`${TRELLO_API_BASE_URL}${path}`)
      url.searchParams.set('key', apiKey)
      url.searchParams.set('token', params.accessToken)

      if (params.filter) {
        url.searchParams.set('filter', params.filter)
      }

      if (params.since) url.searchParams.set('since', params.since)
      if (params.before) url.searchParams.set('before', params.before)

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
      const message = getErrorMessage(error, 'Failed to parse Trello cards')

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
        properties: TRELLO_CARD_OUTPUT_PROPERTIES,
      },
    },
    count: { type: 'number', description: 'Number of cards returned' },
  },
}
