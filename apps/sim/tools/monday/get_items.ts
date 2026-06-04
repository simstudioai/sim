import type { MondayGetItemsParams, MondayGetItemsResponse } from '@/tools/monday/types'
import {
  extractMondayError,
  MONDAY_API_URL,
  mondayHeaders,
  sanitizeLimit,
  sanitizeNumericId,
} from '@/tools/monday/utils'
import type { ToolConfig } from '@/tools/types'

function mapItem(item: Record<string, unknown>): {
  id: string
  name: string
  state: string | null
  boardId: string | null
  groupId: string | null
  groupTitle: string | null
  columnValues: { id: string; text: string | null; value: string | null; type: string }[]
  createdAt: string | null
  updatedAt: string | null
  url: string | null
} {
  const board = item.board as Record<string, unknown> | null
  const group = item.group as Record<string, unknown> | null
  const columnValues = ((item.column_values as Record<string, unknown>[]) ?? []).map((cv) => ({
    id: cv.id as string,
    text: (cv.text as string) ?? null,
    value: (cv.value as string) ?? null,
    type: (cv.type as string) ?? '',
  }))

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
}

export const mondayGetItemsTool: ToolConfig<MondayGetItemsParams, MondayGetItemsResponse> = {
  id: 'monday_get_items',
  name: 'Monday Get Items',
  description: 'Get items from a Monday.com board',
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
      description: 'The ID of the board to get items from',
    },
    groupId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter items by group ID',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of items to return (default 25, max 500)',
    },
  },

  request: {
    url: MONDAY_API_URL,
    method: 'POST',
    headers: (params) => mondayHeaders(params.accessToken),
    body: (params) => {
      const limit = sanitizeLimit(params.limit, 25, 500)
      const boardId = sanitizeNumericId(params.boardId, 'boardId')
      if (params.groupId) {
        return {
          query: `query { boards(ids: [${boardId}]) { groups(ids: [${JSON.stringify(params.groupId)}]) { items_page(limit: ${limit}) { items { id name state board { id } group { id title } column_values { id text value type } created_at updated_at url } } } } }`,
        }
      }
      return {
        query: `query { boards(ids: [${boardId}]) { items_page(limit: ${limit}) { items { id name state board { id } group { id title } column_values { id text value type } created_at updated_at url } } } }`,
      }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()
    const error = extractMondayError(data)
    if (error) {
      return { success: false, output: { items: [], count: 0 }, error }
    }

    const boards = data.data?.boards ?? []
    if (boards.length === 0) {
      return { success: true, output: { items: [], count: 0 } }
    }

    const board = boards[0]
    let rawItems: Record<string, unknown>[] = []

    if (board.groups) {
      for (const group of board.groups) {
        const groupItems = group.items_page?.items ?? []
        rawItems = rawItems.concat(groupItems)
      }
    } else {
      rawItems = board.items_page?.items ?? []
    }

    const items = rawItems.map(mapItem)

    return {
      success: true,
      output: { items, count: items.length },
    }
  },

  outputs: {
    items: {
      type: 'array',
      description: 'List of items from the board',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Item ID' },
          name: { type: 'string', description: 'Item name' },
          state: {
            type: 'string',
            description: 'Item state (active, archived, deleted)',
            optional: true,
          },
          boardId: { type: 'string', description: 'Board ID', optional: true },
          groupId: { type: 'string', description: 'Group ID', optional: true },
          groupTitle: { type: 'string', description: 'Group title', optional: true },
          columnValues: {
            type: 'array',
            description: 'Column values for the item',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Column ID' },
                text: { type: 'string', description: 'Human-readable text value', optional: true },
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
  },
}
