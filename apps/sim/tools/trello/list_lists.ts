import { env } from '@/lib/core/config/env'
import type { TrelloListListsParams, TrelloListListsResponse } from '@/tools/trello/types'
import type { ToolConfig } from '@/tools/types'

export const trelloListListsTool: ToolConfig<TrelloListListsParams, TrelloListListsResponse> = {
  id: 'trello_list_lists',
  name: 'Trello List Lists',
  description: 'List all lists on a Trello board',
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
      description: 'Trello board ID (24-character hex string)',
    },
  },

  request: {
    url: (params) => {
      if (!params.boardId) {
        throw new Error('Board ID is required')
      }
      const apiKey = env.TRELLO_API_KEY || ''
      const token = params.accessToken

      if (!apiKey) {
        throw new Error('TRELLO_API_KEY environment variable is not set')
      }

      if (!token) {
        throw new Error('Trello access token is missing')
      }

      return `https://api.trello.com/1/boards/${params.boardId}/lists?key=${apiKey}&token=${token}`
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
          lists: [],
          count: 0,
          error: data?.message || data?.error || 'Invalid response from Trello API',
        },
        error: data?.message || data?.error || 'Invalid response from Trello API',
      }
    }

    return {
      success: true,
      output: {
        lists: data,
        count: data.length,
      },
    }
  },

  outputs: {
    lists: {
      type: 'array',
      description: 'Array of list objects with id, name, closed, pos, and idBoard',
    },
    count: { type: 'number', description: 'Number of lists returned' },
  },
}
