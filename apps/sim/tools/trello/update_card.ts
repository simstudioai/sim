import { env } from '@/lib/env'
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
      description: 'ID of the card to update',
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
      description: 'Move card to a different list',
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
      const apiKey = env.TRELLO_API_KEY || ''
      const token = params.accessToken
      return `https://api.trello.com/1/cards/${params.cardId}?key=${apiKey}&token=${token}`
    },
    method: 'PUT',
    headers: () => ({
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }),
    body: (params) => {
      const body: Record<string, any> = {}

      if (params.name !== undefined) body.name = params.name
      if (params.desc !== undefined) body.desc = params.desc
      if (params.closed !== undefined) body.closed = params.closed
      if (params.idList !== undefined) body.idList = params.idList
      if (params.due !== undefined) body.due = params.due
      if (params.dueComplete !== undefined) body.dueComplete = params.dueComplete

      if (Object.keys(body).length === 0) {
        throw new Error('At least one field must be provided to update')
      }

      return body
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!data?.id) {
      return {
        success: false,
        output: {
          error: data?.message || 'Failed to update card',
        },
        error: data?.message || 'Failed to update card',
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
    success: { type: 'boolean', description: 'Whether the card was updated successfully' },
    card: {
      type: 'object',
      description: 'The updated card object with id, name, desc, url, and other properties',
    },
    error: { type: 'string', description: 'Error message if operation failed' },
  },
}
