import type { MondayArchiveItemParams, MondayArchiveItemResponse } from '@/tools/monday/types'
import {
  extractMondayError,
  MONDAY_API_URL,
  mondayHeaders,
  sanitizeNumericId,
} from '@/tools/monday/utils'
import type { ToolConfig } from '@/tools/types'

export const mondayArchiveItemTool: ToolConfig<MondayArchiveItemParams, MondayArchiveItemResponse> =
  {
    id: 'monday_archive_item',
    name: 'Monday Archive Item',
    description: 'Archive an item on a Monday.com board',
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
        description: 'The ID of the item to archive',
      },
    },

    request: {
      url: MONDAY_API_URL,
      method: 'POST',
      headers: (params) => mondayHeaders(params.accessToken),
      body: (params) => ({
        query: `mutation { archive_item(item_id: ${sanitizeNumericId(params.itemId, 'itemId')}) { id } }`,
      }),
    },

    transformResponse: async (response) => {
      const data = await response.json()
      const error = extractMondayError(data)
      if (error) {
        return { success: false, output: { id: '' }, error }
      }

      const raw = data.data?.archive_item
      if (!raw) {
        return { success: false, output: { id: '' }, error: 'Failed to archive item' }
      }

      return {
        success: true,
        output: { id: raw.id as string },
      }
    },

    outputs: {
      id: {
        type: 'string',
        description: 'The ID of the archived item',
      },
    },
  }
