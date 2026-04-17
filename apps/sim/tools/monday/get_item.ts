import type { MondayGetItemParams, MondayGetItemResponse } from '@/tools/monday/types'
import {
  extractMondayError,
  MONDAY_API_URL,
  mondayHeaders,
  sanitizeNumericId,
} from '@/tools/monday/utils'
import type { ToolConfig } from '@/tools/types'

export const mondayGetItemTool: ToolConfig<MondayGetItemParams, MondayGetItemResponse> = {
  id: 'monday_get_item',
  name: 'Monday Get Item',
  description: 'Get a specific item by ID from Monday.com',
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
      description: 'The ID of the item to retrieve',
    },
  },

  request: {
    url: MONDAY_API_URL,
    method: 'POST',
    headers: (params) => mondayHeaders(params.accessToken),
    body: (params) => ({
      query: `query { items(ids: [${sanitizeNumericId(params.itemId, 'itemId')}]) { id name state board { id } group { id title } column_values { id text value type } created_at updated_at url } }`,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    const error = extractMondayError(data)
    if (error) {
      return { success: false, output: { item: null }, error }
    }

    const items = data.data?.items ?? []
    if (items.length === 0) {
      return { success: false, output: { item: null }, error: 'Item not found' }
    }

    const raw = items[0]
    const board = raw.board as Record<string, unknown> | null
    const group = raw.group as Record<string, unknown> | null
    const columnValues = ((raw.column_values as Record<string, unknown>[]) ?? []).map(
      (cv: Record<string, unknown>) => ({
        id: cv.id as string,
        text: (cv.text as string) ?? null,
        value: (cv.value as string) ?? null,
        type: (cv.type as string) ?? '',
      })
    )

    return {
      success: true,
      output: {
        item: {
          id: raw.id as string,
          name: (raw.name as string) ?? '',
          state: (raw.state as string) ?? null,
          boardId: board ? (board.id as string) : null,
          groupId: group ? (group.id as string) : null,
          groupTitle: group ? ((group.title as string) ?? null) : null,
          columnValues,
          createdAt: (raw.created_at as string) ?? null,
          updatedAt: (raw.updated_at as string) ?? null,
          url: (raw.url as string) ?? null,
        },
      },
    }
  },

  outputs: {
    item: {
      type: 'json',
      description: 'The requested item',
      optional: true,
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
}
