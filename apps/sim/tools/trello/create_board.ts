import { getErrorMessage } from '@sim/utils/errors'
import { env } from '@/lib/core/config/env'
import {
  extractTrelloErrorMessage,
  mapTrelloBoard,
  TRELLO_API_BASE_URL,
} from '@/tools/trello/shared'
import type { TrelloCreateBoardParams, TrelloCreateBoardResponse } from '@/tools/trello/types'
import type { ToolConfig } from '@/tools/types'

export const trelloCreateBoardTool: ToolConfig<TrelloCreateBoardParams, TrelloCreateBoardResponse> =
  {
    id: 'trello_create_board',
    name: 'Trello Create Board',
    description: 'Create a new Trello board',
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
      name: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Name of the board',
      },
      desc: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Description of the board',
      },
      idOrganization: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'ID or name of the workspace/organization the board belongs to',
      },
      defaultLists: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description: 'Whether to create the default lists (To Do, Doing, Done) on the new board',
      },
    },

    request: {
      url: (params) => {
        if (!params.name) {
          throw new Error('Board name is required')
        }
        const apiKey = env.TRELLO_API_KEY

        if (!apiKey) {
          throw new Error('TRELLO_API_KEY environment variable is not set')
        }

        const url = new URL(`${TRELLO_API_BASE_URL}/boards`)
        url.searchParams.set('key', apiKey)
        url.searchParams.set('token', params.accessToken)
        url.searchParams.set('name', params.name.trim())

        if (params.desc) url.searchParams.set('desc', params.desc)
        if (params.idOrganization)
          url.searchParams.set('idOrganization', params.idOrganization.trim())
        if (params.defaultLists !== undefined) {
          url.searchParams.set('defaultLists', String(params.defaultLists))
        }

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
        const error = extractTrelloErrorMessage(response, data, 'Failed to create board')

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
        const message = getErrorMessage(error, 'Failed to parse created board')

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
        description: 'Created board (id, name, desc, url, closed, idOrganization)',
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
