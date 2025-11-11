import { env } from '@/lib/env'
import type { TrelloCreateCardParams, TrelloCreateCardResponse } from '@/tools/trello/types'
import type { ToolConfig } from '@/tools/types'

export const trelloCreateCardTool: ToolConfig<TrelloCreateCardParams, TrelloCreateCardResponse> = {
  id: 'trello_create_card',
  name: 'Trello Create Card',
  description: 'Create a new card on a Trello board',
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
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the board to create the card on',
    },
    listId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the list to create the card in',
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
    labels: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of label IDs',
    },
  },

  request: {
    url: (params) => {
      const apiKey = env.TRELLO_API_KEY || ''
      const token = params.accessToken
      return `https://api.trello.com/1/cards?key=${apiKey}&token=${token}`
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

      const body: Record<string, any> = {
        idList: params.listId,
        name: params.name,
      }

      if (params.desc) body.desc = params.desc
      if (params.pos) body.pos = params.pos
      if (params.due) body.due = params.due
      if (params.labels) body.idLabels = params.labels

      return body
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!data?.id) {
      return {
        success: false,
        output: {
          error: data?.message || 'Failed to create card',
        },
        error: data?.message || 'Failed to create card',
      }
    }

    return {
      success: true,
      output: {
        card: data,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the card was created successfully' },
    card: {
      type: 'object',
      description: 'The created card object with id, name, desc, url, and other properties',
    },
    error: { type: 'string', description: 'Error message if operation failed' },
  },
}
