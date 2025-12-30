import type { UpdateItemParams, UpdateItemResponse } from '@/tools/monday/types'
import type { ToolConfig } from '@/tools/types'
import { createLogger } from '@sim/logger'
import { QUERIES } from './graphql'

const logger = createLogger('MondayUpdateItem')

export const updateItemTool: ToolConfig<UpdateItemParams, UpdateItemResponse> = {
  id: 'monday_update_item',
  name: 'Update Monday.com Item',
  description: 'Update column values in an existing Monday.com item',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Monday.com API key',
    },
    item_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the item to update',
    },
    board_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The board ID containing the item',
    },
    column_values: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'Column values to update as JSON object',
    },
  },

  request: {
    url: 'https://api.monday.com/v2',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: params.apiKey,
      'API-Version': '2024-01',
    }),
    body: (params) => ({
      query: QUERIES.UPDATE_ITEM,
      variables: {
        boardId: parseInt(params.board_id, 10),
        itemId: parseInt(params.item_id, 10),
        columnValues: JSON.stringify(params.column_values),
      },
    }),
  },

  transformResponse: async (response: Response): Promise<UpdateItemResponse> => {
    if (!response.ok) {
      const errorText = await response.text()
      logger.error('Monday update item failed', {
        status: response.status,
        error: errorText,
      })
      return {
        success: false,
        output: {},
        error: `Monday.com API error: ${response.status} - ${errorText}`,
      }
    }

    const result = await response.json()

    if (result.errors) {
      logger.error('Monday GraphQL errors', { errors: result.errors })
      return {
        success: false,
        output: {},
        error: `GraphQL errors: ${JSON.stringify(result.errors)}`,
      }
    }

    const item = result.data?.change_multiple_column_values

    if (!item) {
      return {
        success: false,
        output: {},
        error: 'No item returned from Monday.com',
      }
    }

    logger.info('Monday item updated successfully', { itemId: item.id })

    return {
      success: true,
      output: {
        item,
        item_id: item.id,
      },
    }
  },
}
