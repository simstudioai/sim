import { getErrorMessage } from '@sim/utils/errors'
import { env } from '@/lib/core/config/env'
import {
  extractTrelloErrorMessage,
  mapTrelloChecklistItem,
  TRELLO_API_BASE_URL,
} from '@/tools/trello/shared'
import type {
  TrelloUpdateChecklistItemParams,
  TrelloUpdateChecklistItemResponse,
} from '@/tools/trello/types'
import type { ToolConfig } from '@/tools/types'

export const trelloUpdateChecklistItemTool: ToolConfig<
  TrelloUpdateChecklistItemParams,
  TrelloUpdateChecklistItemResponse
> = {
  id: 'trello_update_checklist_item',
  name: 'Trello Update Checklist Item',
  description: 'Check off, uncheck, or rename a Trello checklist item',
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
      description: 'Trello card ID that owns the checklist item (24-character hex string)',
    },
    checkItemId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Checklist item ID to update (24-character hex string)',
    },
    state: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Set the item state to complete or incomplete',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New name for the checklist item',
    },
  },

  request: {
    url: (params) => {
      if (!params.cardId) {
        throw new Error('Card ID is required')
      }
      if (!params.checkItemId) {
        throw new Error('Checklist item ID is required')
      }
      if (!params.state && !params.name) {
        throw new Error('At least one of state or name must be provided to update')
      }
      const apiKey = env.TRELLO_API_KEY

      if (!apiKey) {
        throw new Error('TRELLO_API_KEY environment variable is not set')
      }

      const url = new URL(
        `${TRELLO_API_BASE_URL}/cards/${params.cardId.trim()}/checkItem/${params.checkItemId.trim()}`
      )
      url.searchParams.set('key', apiKey)
      url.searchParams.set('token', params.accessToken)

      if (params.state) url.searchParams.set('state', params.state)
      if (params.name) url.searchParams.set('name', params.name.trim())

      return url.toString()
    },
    method: 'PUT',
    headers: () => ({
      Accept: 'application/json',
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json().catch(() => null)

    if (!response.ok) {
      const error = extractTrelloErrorMessage(response, data, 'Failed to update checklist item')

      return {
        success: false,
        output: {
          error,
        },
        error,
      }
    }

    try {
      const item = mapTrelloChecklistItem(data)

      return {
        success: true,
        output: {
          item,
        },
      }
    } catch (error) {
      const message = getErrorMessage(error, 'Failed to parse updated checklist item')

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
    item: {
      type: 'json',
      description: 'Updated checklist item (id, name, state, pos, idChecklist)',
      optional: true,
      properties: {
        id: { type: 'string', description: 'Checklist item ID' },
        name: { type: 'string', description: 'Checklist item name' },
        state: { type: 'string', description: 'Item state (complete or incomplete)' },
        pos: { type: 'number', description: 'Item position on the checklist' },
        idChecklist: {
          type: 'string',
          description: 'Checklist ID containing the item',
          optional: true,
        },
      },
    },
  },
}
