import type { MondayCreateBoardParams, MondayCreateBoardResponse } from '@/tools/monday/types'
import {
  extractMondayError,
  MONDAY_API_URL,
  mondayHeaders,
  sanitizeEnum,
  sanitizeNumericId,
} from '@/tools/monday/utils'
import type { ToolConfig } from '@/tools/types'

const BOARD_KINDS = ['public', 'private', 'share'] as const

export const mondayCreateBoardTool: ToolConfig<MondayCreateBoardParams, MondayCreateBoardResponse> =
  {
    id: 'monday_create_board',
    name: 'Monday Create Board',
    description: 'Create a new board in Monday.com',
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
      boardName: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'The name of the new board',
      },
      boardKind: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'The board kind: public, private, or share',
      },
      description: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'The board description',
      },
      workspaceId: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'The ID of the workspace to create the board in',
      },
      folderId: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'The ID of the folder to create the board in',
      },
    },

    request: {
      url: MONDAY_API_URL,
      method: 'POST',
      headers: (params) => mondayHeaders(params.accessToken),
      body: (params) => {
        const args: string[] = [
          `board_name: ${JSON.stringify(params.boardName)}`,
          `board_kind: ${sanitizeEnum(params.boardKind, 'boardKind', BOARD_KINDS)}`,
        ]
        if (params.description) {
          args.push(`description: ${JSON.stringify(params.description)}`)
        }
        if (params.workspaceId) {
          args.push(`workspace_id: ${sanitizeNumericId(params.workspaceId, 'workspaceId')}`)
        }
        if (params.folderId) {
          args.push(`folder_id: ${sanitizeNumericId(params.folderId, 'folderId')}`)
        }
        return {
          query: `mutation { create_board(${args.join(', ')}) { id name description state board_kind items_count url updated_at } }`,
        }
      },
    },

    transformResponse: async (response) => {
      const data = await response.json()
      const error = extractMondayError(data)
      if (error) {
        return { success: false, output: { board: null }, error }
      }

      const raw = data.data?.create_board
      if (!raw) {
        return { success: false, output: { board: null }, error: 'Failed to create board' }
      }

      return {
        success: true,
        output: {
          board: {
            id: raw.id as string,
            name: (raw.name as string) ?? '',
            description: (raw.description as string) ?? null,
            state: (raw.state as string) ?? 'active',
            boardKind: (raw.board_kind as string) ?? 'public',
            itemsCount: (raw.items_count as number) ?? 0,
            url: (raw.url as string) ?? '',
            updatedAt: (raw.updated_at as string) ?? null,
          },
        },
      }
    },

    outputs: {
      board: {
        type: 'json',
        description: 'The created board',
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
    },
  }
