import { getErrorMessage } from '@sim/utils/errors'
import { env } from '@/lib/core/config/env'
import {
  extractTrelloErrorMessage,
  mapTrelloChecklistItem,
  TRELLO_API_BASE_URL,
} from '@/tools/trello/shared'
import type {
  TrelloAddChecklistItemParams,
  TrelloAddChecklistItemResponse,
} from '@/tools/trello/types'
import type { ToolConfig } from '@/tools/types'

export const trelloAddChecklistItemTool: ToolConfig<
  TrelloAddChecklistItemParams,
  TrelloAddChecklistItemResponse
> = {
  id: 'trello_add_checklist_item',
  name: 'Trello Add Checklist Item',
  description: 'Add an item to a Trello checklist',
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
    checklistId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Trello checklist ID to add the item to (24-character hex string)',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the checklist item',
    },
    pos: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Position of the item (top, bottom, or positive float)',
    },
    checked: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the item should start checked off',
    },
  },

  request: {
    url: (params) => {
      if (!params.checklistId) {
        throw new Error('Checklist ID is required')
      }
      if (!params.name) {
        throw new Error('Checklist item name is required')
      }
      const apiKey = env.TRELLO_API_KEY

      if (!apiKey) {
        throw new Error('TRELLO_API_KEY environment variable is not set')
      }

      const url = new URL(
        `${TRELLO_API_BASE_URL}/checklists/${params.checklistId.trim()}/checkItems`
      )
      url.searchParams.set('key', apiKey)
      url.searchParams.set('token', params.accessToken)
      url.searchParams.set('name', params.name.trim())

      if (params.pos) url.searchParams.set('pos', params.pos)
      if (params.checked !== undefined) url.searchParams.set('checked', String(params.checked))

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
      const error = extractTrelloErrorMessage(response, data, 'Failed to add checklist item')

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
      const message = getErrorMessage(error, 'Failed to parse created checklist item')

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
      description: 'Created checklist item (id, name, state, pos, idChecklist)',
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
