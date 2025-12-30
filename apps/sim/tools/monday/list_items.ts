import type { ListItemsParams, ListItemsResponse } from '@/tools/monday/types'
import type { ToolConfig } from '@/tools/types'
import { createLogger } from '@sim/logger'
import { QUERIES } from './graphql'

const logger = createLogger('MondayListItems')

export const listItemsTool: ToolConfig<ListItemsParams, ListItemsResponse> = {
  id: 'monday_list_items',
  name: 'List Monday.com Items',
  description: 'List items from a Monday.com board',
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
      description: 'The ID of the board to list items from',
    },
    group_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by group ID (optional)',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of items to return (default: 25)',
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
    body: (params) => {
      const query = params.group_id ? QUERIES.LIST_ITEMS : QUERIES.LIST_ITEMS_NO_FILTER
      return {
        query,
        variables: {
          boardId: [parseInt(params.board_id, 10)],
          limit: params.limit || 25,
          groupId: params.group_id,
        },
      }
    },
  },

  transformResponse: async (response: Response): Promise<ListItemsResponse> => {
    if (!response.ok) {
      const errorText = await response.text()
      logger.error('Monday list items failed', {
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

    const items = result.data?.boards?.[0]?.items_page?.items || []

    logger.info('Monday items listed successfully', { count: items.length })

    return {
      success: true,
      output: { items },
    }
  },
}
