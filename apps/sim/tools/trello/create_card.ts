import { env } from '@/lib/core/config/env'
import {
  extractTrelloErrorMessage,
  mapTrelloCard,
  TRELLO_API_BASE_URL,
} from '@/tools/trello/shared'
import type { TrelloCreateCardParams, TrelloCreateCardResponse } from '@/tools/trello/types'
import type { ToolConfig } from '@/tools/types'

export const trelloCreateCardTool: ToolConfig<TrelloCreateCardParams, TrelloCreateCardResponse> = {
  id: 'trello_create_card',
  name: 'Trello Create Card',
  description: 'Create a new card in a Trello list',
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
    listId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Trello list ID (24-character hex string)',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name/title of the card',
    },
    desc: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Description of the card',
    },
    pos: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Position of the card (top, bottom, or positive float)',
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
      description: 'Whether the due date should be marked complete',
    },
    labelIds: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Label IDs to attach to the card',
      items: {
        type: 'string',
        description: 'A Trello label ID',
      },
    },
  },

  request: {
    url: (params) => {
      const apiKey = env.TRELLO_API_KEY

      if (!apiKey) {
        throw new Error('TRELLO_API_KEY environment variable is not set')
      }

      const url = new URL(`${TRELLO_API_BASE_URL}/cards`)
      url.searchParams.set('key', apiKey)
      url.searchParams.set('token', params.accessToken)

      return url.toString()
    },
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }),
    body: (params) => {
      if (!params.name) {
        throw new Error('Card name is required')
      }
      if (!params.listId) {
        throw new Error('List ID is required')
      }

      const body: Record<string, unknown> = {
        idList: params.listId.trim(),
        name: params.name,
      }

      if (params.desc) body.desc = params.desc
      if (params.pos) body.pos = params.pos
      if (params.due) body.due = params.due
      if (params.dueComplete !== undefined) body.dueComplete = params.dueComplete
      if (params.labelIds?.length) body.idLabels = params.labelIds

      return body
    },
  },

  transformResponse: async (response) => {
    const data = await response.json().catch(() => null)

    if (!response.ok) {
      const error = extractTrelloErrorMessage(response, data, 'Failed to create card')

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
      const message = error instanceof Error ? error.message : 'Failed to parse created card'

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
        'Created card (id, name, desc, url, idBoard, idList, closed, labelIds, labels, due, dueComplete)',
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
