import { env } from '@/lib/core/config/env'
import {
  extractTrelloErrorMessage,
  mapTrelloCard,
  TRELLO_API_BASE_URL,
} from '@/tools/trello/shared'
import type { TrelloUpdateCardParams, TrelloUpdateCardResponse } from '@/tools/trello/types'
import type { ToolConfig } from '@/tools/types'

export const trelloUpdateCardTool: ToolConfig<TrelloUpdateCardParams, TrelloUpdateCardResponse> = {
  id: 'trello_update_card',
  name: 'Trello Update Card',
  description: 'Update an existing card on Trello',
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
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New name/title of the card',
    },
    desc: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New description of the card',
    },
    closed: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Archive/close the card (true) or reopen it (false)',
    },
    idList: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Trello list ID to move card to (24-character hex string)',
    },
    due: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Due date (ISO 8601 format)',
    },
    dueComplete: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Mark the due date as complete',
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

      const url = new URL(`${TRELLO_API_BASE_URL}/cards/${params.cardId.trim()}`)
      url.searchParams.set('key', apiKey)
      url.searchParams.set('token', params.accessToken)

      return url.toString()
    },
    method: 'PUT',
    headers: () => ({
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {}

      if (params.name !== undefined) body.name = params.name
      if (params.desc !== undefined) body.desc = params.desc
      if (params.closed !== undefined) body.closed = params.closed
      if (params.idList !== undefined) body.idList = params.idList.trim()
      if (params.due !== undefined) body.due = params.due
      if (params.dueComplete !== undefined) body.dueComplete = params.dueComplete

      if (Object.keys(body).length === 0) {
        throw new Error('At least one field must be provided to update')
      }

      return body
    },
  },

  transformResponse: async (response) => {
    const data = await response.json().catch(() => null)

    if (!response.ok) {
      const error = extractTrelloErrorMessage(response, data, 'Failed to update card')

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
      const message = error instanceof Error ? error.message : 'Failed to parse updated card'

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
        'Updated card (id, name, desc, url, idBoard, idList, closed, labelIds, labels, due, dueComplete)',
      optional: true,
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
}
