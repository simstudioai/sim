import type { MondayDeleteItemParams, MondayDeleteItemResponse } from '@/tools/monday/types'
import {
  extractMondayError,
  MONDAY_API_URL,
  mondayHeaders,
  sanitizeNumericId,
} from '@/tools/monday/utils'
import type { ToolConfig } from '@/tools/types'

export const mondayDeleteItemTool: ToolConfig<MondayDeleteItemParams, MondayDeleteItemResponse> = {
  id: 'monday_delete_item',
  name: 'Monday Delete Item',
  description: 'Delete an item from a Monday.com board',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'monday',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Monday.com OAuth access token',
    },
    itemId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the item to delete',
    },
  },

  request: {
    url: MONDAY_API_URL,
    method: 'POST',
    headers: (params) => mondayHeaders(params.accessToken),
    body: (params) => ({
      query: `mutation { delete_item(item_id: ${sanitizeNumericId(params.itemId, 'itemId')}) { id } }`,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    const error = extractMondayError(data)
    if (error) {
      return { success: false, output: { id: '' }, error }
    }

    const raw = data.data?.delete_item
    if (!raw) {
      return { success: false, output: { id: '' }, error: 'Failed to delete item' }
    }

    return {
      success: true,
      output: { id: raw.id as string },
    }
  },

  outputs: {
    id: {
      type: 'string',
      description: 'The ID of the deleted item',
    },
  },
}
