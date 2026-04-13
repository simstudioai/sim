import { env } from '@/lib/core/config/env'
import {
  extractTrelloErrorMessage,
  mapTrelloList,
  TRELLO_API_BASE_URL,
} from '@/tools/trello/shared'
import type { TrelloListListsParams, TrelloListListsResponse } from '@/tools/trello/types'
import type { ToolConfig } from '@/tools/types'

export const trelloListListsTool: ToolConfig<TrelloListListsParams, TrelloListListsResponse> = {
  id: 'trello_list_lists',
  name: 'Trello Get Lists',
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
      const apiKey = env.TRELLO_API_KEY

      if (!apiKey) {
        throw new Error('TRELLO_API_KEY environment variable is not set')
      }

      if (!params.accessToken) {
        throw new Error('Trello access token is missing')
      }

      const url = new URL(`${TRELLO_API_BASE_URL}/boards/${params.boardId.trim()}/lists`)
      url.searchParams.set('key', apiKey)
      url.searchParams.set('token', params.accessToken)

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
      const error = extractTrelloErrorMessage(response, data, 'Failed to list Trello lists')

      return {
        success: false,
        output: {
          lists: [],
          count: 0,
          error,
        },
        error,
      }
    }

    if (!Array.isArray(data)) {
      const error = 'Trello returned an invalid list collection'

      return {
        success: false,
        output: {
          lists: [],
          count: 0,
          error,
        },
        error,
      }
    }

    try {
      const lists = data.map((item) => mapTrelloList(item))

      return {
        success: true,
        output: {
          lists,
          count: lists.length,
        },
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to parse Trello lists'

      return {
        success: false,
        output: {
          lists: [],
          count: 0,
          error: message,
        },
        error: message,
      }
    }
  },

  outputs: {
    lists: {
      type: 'array',
      description: 'Lists on the selected board',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'List ID' },
          name: { type: 'string', description: 'List name' },
          closed: { type: 'boolean', description: 'Whether the list is archived' },
          pos: { type: 'number', description: 'List position on the board' },
          idBoard: { type: 'string', description: 'Board ID containing the list' },
        },
      },
    },
    count: { type: 'number', description: 'Number of lists returned' },
  },
}
