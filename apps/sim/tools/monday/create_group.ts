import type { MondayCreateGroupParams, MondayCreateGroupResponse } from '@/tools/monday/types'
import {
  extractMondayError,
  MONDAY_API_URL,
  mondayHeaders,
  sanitizeNumericId,
} from '@/tools/monday/utils'
import type { ToolConfig } from '@/tools/types'

export const mondayCreateGroupTool: ToolConfig<MondayCreateGroupParams, MondayCreateGroupResponse> =
  {
    id: 'monday_create_group',
    name: 'Monday Create Group',
    description: 'Create a new group on a Monday.com board',
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
        description: 'The ID of the board to create the group on',
      },
      groupName: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'The name of the new group (max 255 characters)',
      },
      groupColor: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'The group color as a hex code (e.g., "#ff642e")',
      },
    },

    request: {
      url: MONDAY_API_URL,
      method: 'POST',
      headers: (params) => mondayHeaders(params.accessToken),
      body: (params) => {
        const args: string[] = [
          `board_id: ${sanitizeNumericId(params.boardId, 'boardId')}`,
          `group_name: ${JSON.stringify(params.groupName)}`,
        ]
        if (params.groupColor) {
          args.push(`group_color: ${JSON.stringify(params.groupColor)}`)
        }
        return {
          query: `mutation { create_group(${args.join(', ')}) { id title color archived deleted position } }`,
        }
      },
    },

    transformResponse: async (response) => {
      const data = await response.json()
      const error = extractMondayError(data)
      if (error) {
        return { success: false, output: { group: null }, error }
      }

      const raw = data.data?.create_group
      if (!raw) {
        return { success: false, output: { group: null }, error: 'Failed to create group' }
      }

      return {
        success: true,
        output: {
          group: {
            id: raw.id as string,
            title: (raw.title as string) ?? '',
            color: (raw.color as string) ?? '',
            archived: (raw.archived as boolean) ?? null,
            deleted: (raw.deleted as boolean) ?? null,
            position: (raw.position as string) ?? '',
          },
        },
      }
    },

    outputs: {
      group: {
        type: 'json',
        description: 'The created group',
        optional: true,
        properties: {
          id: { type: 'string', description: 'Group ID' },
          title: { type: 'string', description: 'Group title' },
          color: { type: 'string', description: 'Group color (hex)' },
          archived: { type: 'boolean', description: 'Whether archived', optional: true },
          deleted: { type: 'boolean', description: 'Whether deleted', optional: true },
          position: { type: 'string', description: 'Group position' },
        },
      },
    },
  }
