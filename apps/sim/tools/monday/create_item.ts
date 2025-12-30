import type { CreateItemParams, CreateItemResponse } from '@/tools/monday/types'
import type { ToolConfig } from '@/tools/types'
import { createLogger } from '@sim/logger'
import { QUERIES } from './graphql'

const logger = createLogger('MondayCreateItem')

export const createItemTool: ToolConfig<CreateItemParams, CreateItemResponse> = {
  id: 'monday_create_item',
  name: 'Create Monday.com Item',
  description: 'Create a new item in a Monday.com board',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Monday.com API key',
    },
    board_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the board to create the item in',
    },
    group_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The group (section) ID within the board (optional)',
    },
    item_name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The name of the item to create',
    },
    column_values: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Column values as JSON object (optional)',
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
      query: QUERIES.CREATE_ITEM,
      variables: {
        boardId: parseInt(params.board_id, 10),
        groupId: params.group_id,
        itemName: params.item_name,
        columnValues: params.column_values ? JSON.stringify(params.column_values) : undefined,
      },
    }),
  },

  transformResponse: async (response: Response): Promise<CreateItemResponse> => {
    if (!response.ok) {
      const errorText = await response.text()
      logger.error('Monday create item failed', {
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

    const item = result.data?.create_item

    if (!item) {
      return {
        success: false,
        output: {},
        error: 'No item returned from Monday.com',
      }
    }

    logger.info('Monday item created successfully', {
      itemId: item.id,
      boardId: item.board?.id,
    })

    return {
      success: true,
      output: {
        item,
        item_id: item.id,
      },
    }
  },
}
