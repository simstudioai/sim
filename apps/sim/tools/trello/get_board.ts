import { getErrorMessage } from '@sim/utils/errors'
import { env } from '@/lib/core/config/env'
import {
  extractTrelloErrorMessage,
  mapTrelloBoard,
  TRELLO_API_BASE_URL,
} from '@/tools/trello/shared'
import type { TrelloGetBoardParams, TrelloGetBoardResponse } from '@/tools/trello/types'
import type { ToolConfig } from '@/tools/types'

export const trelloGetBoardTool: ToolConfig<TrelloGetBoardParams, TrelloGetBoardResponse> = {
  id: 'trello_get_board',
  name: 'Trello Get Board',
  description: 'Retrieve a single Trello board by ID',
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

      const url = new URL(`${TRELLO_API_BASE_URL}/boards/${params.boardId.trim()}`)
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
      const error = extractTrelloErrorMessage(response, data, 'Failed to get board')

      return {
        success: false,
        output: {
          error,
        },
        error,
      }
    }

    try {
      const board = mapTrelloBoard(data)

      return {
        success: true,
        output: {
          board,
        },
      }
    } catch (error) {
      const message = getErrorMessage(error, 'Failed to parse board')

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
    board: {
      type: 'json',
      description: 'Board (id, name, desc, url, closed, idOrganization)',
      optional: true,
      properties: {
        id: { type: 'string', description: 'Board ID' },
        name: { type: 'string', description: 'Board name' },
        desc: { type: 'string', description: 'Board description' },
        url: { type: 'string', description: 'Full board URL' },
        closed: { type: 'boolean', description: 'Whether the board is closed' },
        idOrganization: {
          type: 'string',
          description: 'ID of the workspace/organization the board belongs to',
          optional: true,
        },
      },
    },
  },
}
