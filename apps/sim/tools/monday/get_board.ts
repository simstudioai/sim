import type { MondayGetBoardParams, MondayGetBoardResponse } from '@/tools/monday/types'
import {
  extractMondayError,
  MONDAY_API_URL,
  mondayHeaders,
  sanitizeNumericId,
} from '@/tools/monday/utils'
import type { ToolConfig } from '@/tools/types'

export const mondayGetBoardTool: ToolConfig<MondayGetBoardParams, MondayGetBoardResponse> = {
  id: 'monday_get_board',
  name: 'Monday Get Board',
  description: 'Get a specific Monday.com board with its groups and columns',
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
      description: 'The ID of the board to retrieve',
    },
  },

  request: {
    url: MONDAY_API_URL,
    method: 'POST',
    headers: (params) => mondayHeaders(params.accessToken),
    body: (params) => ({
      query: `query { boards(ids: [${sanitizeNumericId(params.boardId, 'boardId')}]) { id name description state board_kind items_count url updated_at groups { id title color archived deleted position } columns { id title type } } }`,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    const error = extractMondayError(data)
    if (error) {
      return { success: false, output: { board: null, groups: [], columns: [] }, error }
    }

    const boards = data.data?.boards ?? []
    if (boards.length === 0) {
      return {
        success: false,
        output: { board: null, groups: [], columns: [] },
        error: 'Board not found',
      }
    }

    const b = boards[0]
    const board = {
      id: b.id as string,
      name: (b.name as string) ?? '',
      description: (b.description as string) ?? null,
      state: (b.state as string) ?? 'active',
      boardKind: (b.board_kind as string) ?? 'public',
      itemsCount: (b.items_count as number) ?? 0,
      url: (b.url as string) ?? '',
      updatedAt: (b.updated_at as string) ?? null,
    }

    const groups = (b.groups ?? []).map((g: Record<string, unknown>) => ({
      id: g.id as string,
      title: (g.title as string) ?? '',
      color: (g.color as string) ?? '',
      archived: (g.archived as boolean) ?? null,
      deleted: (g.deleted as boolean) ?? null,
      position: (g.position as string) ?? '',
    }))

    const columns = (b.columns ?? []).map((c: Record<string, unknown>) => ({
      id: c.id as string,
      title: (c.title as string) ?? '',
      type: (c.type as string) ?? '',
    }))

    return {
      success: true,
      output: { board, groups, columns },
    }
  },

  outputs: {
    board: {
      type: 'json',
      description: 'Board details',
      optional: true,
      properties: {
        id: { type: 'string', description: 'Board ID' },
        name: { type: 'string', description: 'Board name' },
        description: { type: 'string', description: 'Board description', optional: true },
        state: { type: 'string', description: 'Board state' },
        boardKind: { type: 'string', description: 'Board kind (public, private, share)' },
        itemsCount: { type: 'number', description: 'Number of items' },
        url: { type: 'string', description: 'Board URL' },
        updatedAt: { type: 'string', description: 'Last updated timestamp', optional: true },
      },
    },
    groups: {
      type: 'array',
      description: 'Groups on the board',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Group ID' },
          title: { type: 'string', description: 'Group title' },
          color: { type: 'string', description: 'Group color (hex)' },
          archived: {
            type: 'boolean',
            description: 'Whether the group is archived',
            optional: true,
          },
          deleted: { type: 'boolean', description: 'Whether the group is deleted', optional: true },
          position: { type: 'string', description: 'Group position' },
        },
      },
    },
    columns: {
      type: 'array',
      description: 'Columns on the board',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Column ID' },
          title: { type: 'string', description: 'Column title' },
          type: { type: 'string', description: 'Column type' },
        },
      },
    },
  },
}
