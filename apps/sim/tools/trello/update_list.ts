import { getErrorMessage } from '@sim/utils/errors'
import { env } from '@/lib/core/config/env'
import {
  extractTrelloErrorMessage,
  mapTrelloList,
  TRELLO_API_BASE_URL,
} from '@/tools/trello/shared'
import type { TrelloUpdateListParams, TrelloUpdateListResponse } from '@/tools/trello/types'
import type { ToolConfig } from '@/tools/types'

export const trelloUpdateListTool: ToolConfig<TrelloUpdateListParams, TrelloUpdateListResponse> = {
  id: 'trello_update_list',
  name: 'Trello Update List',
  description: 'Rename, move, archive, or reopen a Trello list',
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
      required: false,
      visibility: 'user-or-llm',
      description: 'New name of the list',
    },
    closed: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Archive the list (true) or reopen it (false)',
    },
    idBoard: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Board ID to move the list to (24-character hex string)',
    },
    pos: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New position of the list (top, bottom, or positive float)',
    },
  },

  request: {
    url: (params) => {
      if (!params.listId) {
        throw new Error('List ID is required')
      }
      const apiKey = env.TRELLO_API_KEY

      if (!apiKey) {
        throw new Error('TRELLO_API_KEY environment variable is not set')
      }

      const url = new URL(`${TRELLO_API_BASE_URL}/lists/${params.listId.trim()}`)
      url.searchParams.set('key', apiKey)
      url.searchParams.set('token', params.accessToken)

      return url.toString()
    },
    method: 'PUT',
    headers: () => ({
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {}

      if (params.name !== undefined) body.name = params.name
      if (params.closed !== undefined) body.closed = params.closed
      if (params.idBoard !== undefined) body.idBoard = params.idBoard.trim()
      if (params.pos !== undefined) body.pos = params.pos

      if (Object.keys(body).length === 0) {
        throw new Error('At least one field must be provided to update')
      }

      return body
    },
  },

  transformResponse: async (response) => {
    const data = await response.json().catch(() => null)

    if (!response.ok) {
      const error = extractTrelloErrorMessage(response, data, 'Failed to update list')

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
      const message = getErrorMessage(error, 'Failed to parse updated list')

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
      description: 'Updated list (id, name, closed, pos, idBoard)',
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
