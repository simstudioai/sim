import type { MondaySearchItemsParams, MondaySearchItemsResponse } from '@/tools/monday/types'
import {
  extractMondayError,
  MONDAY_API_URL,
  mondayHeaders,
  sanitizeLimit,
  sanitizeNumericId,
} from '@/tools/monday/utils'
import type { ToolConfig } from '@/tools/types'

export const mondaySearchItemsTool: ToolConfig<MondaySearchItemsParams, MondaySearchItemsResponse> =
  {
    id: 'monday_search_items',
    name: 'Monday Search Items',
    description: 'Search for items on a Monday.com board by column values',
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
      boardId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'The ID of the board to search',
      },
      columns: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description:
          'JSON array of column filters, e.g. [{"column_id":"status","column_values":["Done"]}]',
      },
      limit: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'Maximum number of items to return (default 25, max 500)',
      },
      cursor: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Pagination cursor from a previous search response',
      },
    },

    request: {
      url: MONDAY_API_URL,
      method: 'POST',
      headers: (params) => mondayHeaders(params.accessToken),
      body: (params) => {
        const limit = sanitizeLimit(params.limit, 25, 500)
        if (params.cursor) {
          return {
            query: `query { next_items_page(limit: ${limit}, cursor: ${JSON.stringify(params.cursor)}) { cursor items { id name state board { id } group { id title } column_values { id text value type } created_at updated_at url } } }`,
          }
        }
        const boardId = sanitizeNumericId(params.boardId, 'boardId')
        let columnsJson: string
        try {
          columnsJson =
            typeof params.columns === 'string'
              ? JSON.stringify(JSON.parse(params.columns))
              : JSON.stringify(params.columns)
        } catch {
          throw new Error(
            'Column filters must be a valid JSON array, e.g. [{"column_id":"status","column_values":["Done"]}]'
          )
        }
        return {
          query: `query { items_page_by_column_values(limit: ${limit}, board_id: ${boardId}, columns: ${columnsJson}) { cursor items { id name state board { id } group { id title } column_values { id text value type } created_at updated_at url } } }`,
        }
      },
    },

    transformResponse: async (response) => {
      const data = await response.json()
      const error = extractMondayError(data)
      if (error) {
        return { success: false, output: { items: [], count: 0, cursor: null }, error }
      }

      const page = data.data?.items_page_by_column_values ?? data.data?.next_items_page
      if (!page) {
        return { success: true, output: { items: [], count: 0, cursor: null } }
      }

      const items = (page.items ?? []).map((item: Record<string, unknown>) => {
        const board = item.board as Record<string, unknown> | null
        const group = item.group as Record<string, unknown> | null
        const columnValues = ((item.column_values as Record<string, unknown>[]) ?? []).map(
          (cv: Record<string, unknown>) => ({
            id: cv.id as string,
            text: (cv.text as string) ?? null,
            value: (cv.value as string) ?? null,
            type: (cv.type as string) ?? '',
          })
        )

        return {
          id: item.id as string,
          name: (item.name as string) ?? '',
          state: (item.state as string) ?? null,
          boardId: board ? (board.id as string) : null,
          groupId: group ? (group.id as string) : null,
          groupTitle: group ? ((group.title as string) ?? null) : null,
          columnValues,
          createdAt: (item.created_at as string) ?? null,
          updatedAt: (item.updated_at as string) ?? null,
          url: (item.url as string) ?? null,
        }
      })

      return {
        success: true,
        output: {
          items,
          count: items.length,
          cursor: (page.cursor as string) ?? null,
        },
      }
    },

    outputs: {
      items: {
        type: 'array',
        description: 'Matching items',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Item ID' },
            name: { type: 'string', description: 'Item name' },
            state: { type: 'string', description: 'Item state', optional: true },
            boardId: { type: 'string', description: 'Board ID', optional: true },
            groupId: { type: 'string', description: 'Group ID', optional: true },
            groupTitle: { type: 'string', description: 'Group title', optional: true },
            columnValues: {
              type: 'array',
              description: 'Column values',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string', description: 'Column ID' },
                  text: { type: 'string', description: 'Text value', optional: true },
                  value: { type: 'string', description: 'Raw JSON value', optional: true },
                  type: { type: 'string', description: 'Column type' },
                },
              },
            },
            createdAt: { type: 'string', description: 'Creation timestamp', optional: true },
            updatedAt: { type: 'string', description: 'Last updated timestamp', optional: true },
            url: { type: 'string', description: 'Item URL', optional: true },
          },
        },
      },
      count: {
        type: 'number',
        description: 'Number of items returned',
      },
      cursor: {
        type: 'string',
        description: 'Pagination cursor for fetching the next page',
        optional: true,
      },
    },
  }
