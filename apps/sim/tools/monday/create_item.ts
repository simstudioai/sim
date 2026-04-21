import type { MondayCreateItemParams, MondayCreateItemResponse } from '@/tools/monday/types'
import {
  extractMondayError,
  MONDAY_API_URL,
  mondayHeaders,
  sanitizeNumericId,
} from '@/tools/monday/utils'
import type { ToolConfig } from '@/tools/types'

export const mondayCreateItemTool: ToolConfig<MondayCreateItemParams, MondayCreateItemResponse> = {
  id: 'monday_create_item',
  name: 'Monday Create Item',
  description: 'Create a new item on a Monday.com board',
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
      description: 'The ID of the board to create the item on',
    },
    itemName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The name of the new item',
    },
    groupId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The group ID to create the item in',
    },
    columnValues: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON string of column values to set (e.g., {"status":"Done","date":"2024-01-01"})',
    },
  },

  request: {
    url: MONDAY_API_URL,
    method: 'POST',
    headers: (params) => mondayHeaders(params.accessToken),
    body: (params) => {
      const args: string[] = [
        `board_id: ${sanitizeNumericId(params.boardId, 'boardId')}`,
        `item_name: ${JSON.stringify(params.itemName)}`,
      ]
      if (params.groupId) {
        args.push(`group_id: ${JSON.stringify(params.groupId)}`)
      }
      if (params.columnValues) {
        args.push(`column_values: ${JSON.stringify(params.columnValues)}`)
      }
      return {
        query: `mutation { create_item(${args.join(', ')}) { id name state board { id } group { id title } column_values { id text value type } created_at updated_at url } }`,
      }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()
    const error = extractMondayError(data)
    if (error) {
      return { success: false, output: { item: null }, error }
    }

    const raw = data.data?.create_item
    if (!raw) {
      return { success: false, output: { item: null }, error: 'Failed to create item' }
    }

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
      description: 'The created item',
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
