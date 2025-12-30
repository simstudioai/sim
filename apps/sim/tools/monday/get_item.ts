import type { GetItemParams, GetItemResponse } from '@/tools/monday/types'
import type { ToolConfig } from '@/tools/types'
import { createLogger } from '@sim/logger'
import { QUERIES } from './graphql'

const logger = createLogger('MondayGetItem')

export const getItemTool: ToolConfig<GetItemParams, GetItemResponse> = {
  id: 'monday_get_item',
  name: 'Get Monday.com Item',
  description: 'Retrieve a Monday.com item by ID',
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
      description: 'The ID of the item to retrieve',
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
      query: QUERIES.GET_ITEM,
      variables: {
        itemId: [parseInt(params.item_id, 10)],
      },
    }),
  },

  transformResponse: async (response: Response): Promise<GetItemResponse> => {
    if (!response.ok) {
      const errorText = await response.text()
      logger.error('Monday get item failed', {
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

    const item = result.data?.items?.[0]

    if (!item) {
      return {
        success: false,
        output: {},
        error: 'Item not found',
      }
    }

    logger.info('Monday item retrieved successfully', { itemId: item.id })

    return {
      success: true,
      output: { item },
    }
  },
}
