import { getErrorMessage } from '@sim/utils/errors'
import { env } from '@/lib/core/config/env'
import {
  extractTrelloErrorMessage,
  mapTrelloChecklist,
  TRELLO_API_BASE_URL,
} from '@/tools/trello/shared'
import type { TrelloAddChecklistParams, TrelloAddChecklistResponse } from '@/tools/trello/types'
import type { ToolConfig } from '@/tools/types'

export const trelloAddChecklistTool: ToolConfig<
  TrelloAddChecklistParams,
  TrelloAddChecklistResponse
> = {
  id: 'trello_add_checklist',
  name: 'Trello Add Checklist',
  description: 'Add a checklist to a Trello card',
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
      description: 'Trello card ID to add the checklist to (24-character hex string)',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the checklist',
    },
    pos: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Position of the checklist (top, bottom, or positive float)',
    },
  },

  request: {
    url: (params) => {
      if (!params.cardId) {
        throw new Error('Card ID is required')
      }
      if (!params.name) {
        throw new Error('Checklist name is required')
      }
      const apiKey = env.TRELLO_API_KEY

      if (!apiKey) {
        throw new Error('TRELLO_API_KEY environment variable is not set')
      }

      const url = new URL(`${TRELLO_API_BASE_URL}/cards/${params.cardId.trim()}/checklists`)
      url.searchParams.set('key', apiKey)
      url.searchParams.set('token', params.accessToken)
      url.searchParams.set('name', params.name.trim())

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
      const error = extractTrelloErrorMessage(response, data, 'Failed to add checklist')

      return {
        success: false,
        output: {
          error,
        },
        error,
      }
    }

    try {
      const checklist = mapTrelloChecklist(data)

      return {
        success: true,
        output: {
          checklist,
        },
      }
    } catch (error) {
      const message = getErrorMessage(error, 'Failed to parse created checklist')

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
    checklist: {
      type: 'json',
      description: 'Created checklist (id, name, idCard, idBoard, pos)',
      optional: true,
      properties: {
        id: { type: 'string', description: 'Checklist ID' },
        name: { type: 'string', description: 'Checklist name' },
        idCard: { type: 'string', description: 'Card ID containing the checklist' },
        idBoard: {
          type: 'string',
          description: 'Board ID containing the checklist',
          optional: true,
        },
        pos: { type: 'number', description: 'Checklist position on the card' },
      },
    },
  },
}
