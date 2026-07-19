import type { MondayCreateColumnParams, MondayCreateColumnResponse } from '@/tools/monday/types'
import {
  extractMondayError,
  MONDAY_API_URL,
  mondayHeaders,
  sanitizeEnum,
  sanitizeNumericId,
} from '@/tools/monday/utils'
import type { ToolConfig } from '@/tools/types'

const COLUMN_TYPES = [
  'auto_number',
  'board_relation',
  'button',
  'checkbox',
  'color_picker',
  'country',
  'date',
  'dependency',
  'doc',
  'dropdown',
  'email',
  'file',
  'formula',
  'hour',
  'item_id',
  'link',
  'location',
  'long_text',
  'mirror',
  'name',
  'numbers',
  'people',
  'phone',
  'progress',
  'rating',
  'status',
  'tags',
  'team',
  'text',
  'timeline',
  'time_tracking',
  'vote',
  'week',
  'world_clock',
] as const

export const mondayCreateColumnTool: ToolConfig<
  MondayCreateColumnParams,
  MondayCreateColumnResponse
> = {
  id: 'monday_create_column',
  name: 'Monday Create Column',
  description: 'Create a new column on a Monday.com board',
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
      description: 'The ID of the board to create the column on',
    },
    columnTitle: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The title of the new column',
    },
    columnType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The column type (e.g., status, text, numbers, date, people, dropdown)',
    },
    columnDescription: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The column description',
    },
    columnDefaults: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'JSON string of default settings for the column (e.g., status labels)',
    },
  },

  request: {
    url: MONDAY_API_URL,
    method: 'POST',
    headers: (params) => mondayHeaders(params.accessToken),
    body: (params) => {
      const args: string[] = [
        `board_id: ${sanitizeNumericId(params.boardId, 'boardId')}`,
        `title: ${JSON.stringify(params.columnTitle)}`,
        `column_type: ${sanitizeEnum(params.columnType, 'columnType', COLUMN_TYPES)}`,
      ]
      if (params.columnDescription) {
        args.push(`description: ${JSON.stringify(params.columnDescription)}`)
      }
      if (params.columnDefaults) {
        args.push(`defaults: ${JSON.stringify(params.columnDefaults)}`)
      }
      return {
        query: `mutation { create_column(${args.join(', ')}) { id title type } }`,
      }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()
    const error = extractMondayError(data)
    if (error) {
      return { success: false, output: { column: null }, error }
    }

    const raw = data.data?.create_column
    if (!raw) {
      return { success: false, output: { column: null }, error: 'Failed to create column' }
    }

    return {
      success: true,
      output: {
        column: {
          id: raw.id as string,
          title: (raw.title as string) ?? '',
          type: (raw.type as string) ?? '',
        },
      },
    }
  },

  outputs: {
    column: {
      type: 'json',
      description: 'The created column',
      optional: true,
      properties: {
        id: { type: 'string', description: 'Column ID' },
        title: { type: 'string', description: 'Column title' },
        type: { type: 'string', description: 'Column type' },
      },
    },
  },
}
