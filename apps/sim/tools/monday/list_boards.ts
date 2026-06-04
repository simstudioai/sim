import type { MondayListBoardsParams, MondayListBoardsResponse } from '@/tools/monday/types'
import {
  extractMondayError,
  MONDAY_API_URL,
  mondayHeaders,
  sanitizeLimit,
} from '@/tools/monday/utils'
import type { ToolConfig } from '@/tools/types'

export const mondayListBoardsTool: ToolConfig<MondayListBoardsParams, MondayListBoardsResponse> = {
  id: 'monday_list_boards',
  name: 'Monday List Boards',
  description: 'List boards from your Monday.com account',
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
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of boards to return (default 25, max 500)',
    },
    page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page number for pagination (starts at 1)',
    },
  },

  request: {
    url: MONDAY_API_URL,
    method: 'POST',
    headers: (params) => mondayHeaders(params.accessToken),
    body: (params) => {
      const limit = sanitizeLimit(params.limit, 25, 500)
      const page = sanitizeLimit(params.page, 1, 10000)
      return {
        query: `query { boards(limit: ${limit}, page: ${page}, state: active) { id name description state board_kind items_count url updated_at } }`,
      }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()
    const error = extractMondayError(data)
    if (error) {
      return { success: false, output: { boards: [], count: 0 }, error }
    }

    const boards = (data.data?.boards ?? []).map((b: Record<string, unknown>) => ({
      id: b.id as string,
      name: (b.name as string) ?? '',
      description: (b.description as string) ?? null,
      state: (b.state as string) ?? 'active',
      boardKind: (b.board_kind as string) ?? 'public',
      itemsCount: (b.items_count as number) ?? 0,
      url: (b.url as string) ?? '',
      updatedAt: (b.updated_at as string) ?? null,
    }))

    return {
      success: true,
      output: { boards, count: boards.length },
    }
  },

  outputs: {
    boards: {
      type: 'array',
      description: 'List of Monday.com boards',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Board ID' },
          name: { type: 'string', description: 'Board name' },
          description: { type: 'string', description: 'Board description', optional: true },
          state: { type: 'string', description: 'Board state (active, archived, deleted)' },
          boardKind: { type: 'string', description: 'Board kind (public, private, share)' },
          itemsCount: { type: 'number', description: 'Number of items on the board' },
          url: { type: 'string', description: 'Board URL' },
          updatedAt: { type: 'string', description: 'Last updated timestamp', optional: true },
        },
      },
    },
    count: {
      type: 'number',
      description: 'Number of boards returned',
    },
  },
}
