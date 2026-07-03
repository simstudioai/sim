import { getErrorMessage } from '@sim/utils/errors'
import { env } from '@/lib/core/config/env'
import {
  extractTrelloErrorMessage,
  mapTrelloList,
  TRELLO_API_BASE_URL,
} from '@/tools/trello/shared'
import type { TrelloCreateListParams, TrelloCreateListResponse } from '@/tools/trello/types'
import type { ToolConfig } from '@/tools/types'

export const trelloCreateListTool: ToolConfig<TrelloCreateListParams, TrelloCreateListResponse> = {
  id: 'trello_create_list',
  name: 'Trello Create List',
  description: 'Create a new list on a Trello board',
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
      description: 'Trello board ID the list belongs to (24-character hex string)',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the list',
    },
    pos: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Position of the list (top, bottom, or positive float)',
    },
  },

  request: {
    url: (params) => {
      if (!params.name) {
        throw new Error('List name is required')
      }
      if (!params.boardId) {
        throw new Error('Board ID is required')
      }
      const apiKey = env.TRELLO_API_KEY

      if (!apiKey) {
        throw new Error('TRELLO_API_KEY environment variable is not set')
      }

      const url = new URL(`${TRELLO_API_BASE_URL}/lists`)
      url.searchParams.set('key', apiKey)
      url.searchParams.set('token', params.accessToken)
      url.searchParams.set('name', params.name.trim())
      url.searchParams.set('idBoard', params.boardId.trim())

      if (params.pos) url.searchParams.set('pos', params.pos)

      return url.toString()
    },
    method: 'POST',
    headers: () => ({
      Accept: 'application/json',
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json().catch(() => null)

    if (!response.ok) {
      const error = extractTrelloErrorMessage(response, data, 'Failed to create list')

      return {
        success: false,
        output: {
          error,
        },
        error,
      }
    }

    try {
      const list = mapTrelloList(data)

      return {
        success: true,
        output: {
          list,
        },
      }
    } catch (error) {
      const message = getErrorMessage(error, 'Failed to parse created list')

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
    list: {
      type: 'json',
      description: 'Created list (id, name, closed, pos, idBoard)',
      optional: true,
      properties: {
        id: { type: 'string', description: 'List ID' },
        name: { type: 'string', description: 'List name' },
        closed: { type: 'boolean', description: 'Whether the list is archived' },
        pos: { type: 'number', description: 'List position on the board' },
        idBoard: { type: 'string', description: 'Board ID containing the list' },
      },
    },
  },
}
