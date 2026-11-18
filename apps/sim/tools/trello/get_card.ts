import { getErrorMessage } from '@sim/utils/errors'
import { env } from '@/lib/core/config/env'
import {
  extractTrelloErrorMessage,
  mapTrelloCard,
  TRELLO_API_BASE_URL,
} from '@/tools/trello/shared'
import type { TrelloGetCardParams, TrelloGetCardResponse } from '@/tools/trello/types'
import { TRELLO_CARD_OUTPUT_PROPERTIES } from '@/tools/trello/types'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const trelloGetCardTool: ToolConfig<TrelloGetCardParams, TrelloGetCardResponse> = {
  id: 'trello_get_card',
  name: 'Trello Get Card',
  description: 'Retrieve a single Trello card by ID',
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
    includeChecklists: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include each card checklist with its items (default false)',
    },
    includeAttachments: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include card attachments (default false)',
    },
    includeMembers: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include member objects for the members on the card (default false)',
    },
  },

  request: {
    url: (params) => {
      if (!params.cardId) {
        throw new Error('Card ID is required')
      }
      const apiKey = env.TRELLO_API_KEY

      if (!apiKey) {
        throw new Error('TRELLO_API_KEY environment variable is not set')
      }

      const url = new URL(
        `${TRELLO_API_BASE_URL}/cards/${safeUrlPathSegment(params.cardId, 'cardId')}`
      )
      url.searchParams.set('key', apiKey)
      url.searchParams.set('token', params.accessToken)
      url.searchParams.set('fields', 'all')
      if (params.includeChecklists) url.searchParams.set('checklists', 'all')
      if (params.includeAttachments) url.searchParams.set('attachments', 'true')
      if (params.includeMembers) url.searchParams.set('members', 'true')

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
      const error = extractTrelloErrorMessage(response, data, 'Failed to get card')

      return {
        success: false,
        output: {
          error,
        },
        error,
      }
    }

    try {
      const card = mapTrelloCard(data)

      return {
        success: true,
        output: {
          card,
        },
      }
    } catch (error) {
      const message = getErrorMessage(error, 'Failed to parse card')

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
    card: {
      type: 'json',
      description:
        'Card (id, name, desc, url, shortUrl, shortLink, idShort, idBoard, idList, closed, pos, labelIds, labels, idMembers, idChecklists, due, start, dueComplete, dateLastActivity, badges, checklists, attachments, members)',
      optional: true,
      properties: TRELLO_CARD_OUTPUT_PROPERTIES,
    },
  },
}
