import { env } from '@/lib/env'
import type { TrelloListCardsParams, TrelloListCardsResponse } from '@/tools/trello/types'
import type { ToolConfig } from '@/tools/types'

export const trelloListCardsTool: ToolConfig<TrelloListCardsParams, TrelloListCardsResponse> = {
  id: 'trello_list_cards',
  name: 'Trello List Cards',
  description: 'List all cards on a Trello board',
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
      description: 'ID of the board to list cards from',
    },
    listId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional: Filter cards by list ID',
    },
  },

  request: {
    url: (params) => {
      if (!params.boardId) {
        throw new Error('Board ID is required')
      }
      const apiKey = env.TRELLO_API_KEY || ''
      const token = params.accessToken
      let url = `https://api.trello.com/1/boards/${params.boardId}/cards?key=${apiKey}&token=${token}&fields=id,name,desc,url,idBoard,idList,closed,labels,due,dueComplete`
      if (params.listId) {
        url += `&list=${params.listId}`
      }
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
          cards: [],
          count: 0,
          error: 'Invalid response from Trello API',
        },
        error: 'Invalid response from Trello API',
      }
    }

    return {
      success: true,
      output: {
        cards: data,
        count: data.length,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the operation was successful' },
    cards: {
      type: 'array',
      description:
        'Array of card objects with id, name, desc, url, board/list IDs, labels, and due date',
    },
    count: { type: 'number', description: 'Number of cards returned' },
    error: { type: 'string', description: 'Error message if operation failed' },
  },
}
