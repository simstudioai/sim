import { env } from '@/lib/env'
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
      description: 'ID of the board to get actions from (either boardId or cardId required)',
    },
    cardId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ID of the card to get actions from (either boardId or cardId required)',
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
      description: 'Maximum number of actions to return (default: 50, max: 1000)',
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

      const id = params.boardId || params.cardId
      const type = params.boardId ? 'boards' : 'cards'
      const apiKey = env.TRELLO_API_KEY || ''
      const token = params.accessToken

      let url = `https://api.trello.com/1/${type}/${id}/actions?key=${apiKey}&token=${token}&fields=id,type,date,memberCreator,data`

      if (params.filter) {
        url += `&filter=${params.filter}`
      }

      const limit = params.limit || 50
      url += `&limit=${limit}`

      return url
    },
    method: 'GET',
    headers: () => ({
      Accept: 'application/json',
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!Array.isArray(data)) {
      return {
        success: false,
        output: {
          actions: [],
          count: 0,
          error: 'Invalid response from Trello API',
        },
        error: 'Invalid response from Trello API',
      }
    }

    return {
      success: true,
      output: {
        actions: data,
        count: data.length,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the operation was successful' },
    actions: {
      type: 'array',
      description: 'Array of action objects with type, date, member, and data',
    },
    count: { type: 'number', description: 'Number of actions returned' },
    error: { type: 'string', description: 'Error message if operation failed' },
  },
}
