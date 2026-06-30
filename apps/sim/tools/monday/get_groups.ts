import type { MondayGetGroupsParams, MondayGetGroupsResponse } from '@/tools/monday/types'
import {
  extractMondayError,
  MONDAY_API_URL,
  mondayHeaders,
  sanitizeNumericId,
} from '@/tools/monday/utils'
import type { ToolConfig } from '@/tools/types'

export const mondayGetGroupsTool: ToolConfig<MondayGetGroupsParams, MondayGetGroupsResponse> = {
  id: 'monday_get_groups',
  name: 'Monday Get Groups',
  description: 'Get the groups on a Monday.com board',
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
      description: 'The ID of the board to retrieve groups from',
    },
  },

  request: {
    url: MONDAY_API_URL,
    method: 'POST',
    headers: (params) => mondayHeaders(params.accessToken),
    body: (params) => ({
      query: `query { boards(ids: [${sanitizeNumericId(params.boardId, 'boardId')}]) { groups { id title color archived deleted position } } }`,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    const error = extractMondayError(data)
    if (error) {
      return { success: false, output: { groups: [], count: 0 }, error }
    }

    const boards = data.data?.boards ?? []
    if (boards.length === 0) {
      return { success: false, output: { groups: [], count: 0 }, error: 'Board not found' }
    }

    const groups = (boards[0].groups ?? []).map((g: Record<string, unknown>) => ({
      id: g.id as string,
      title: (g.title as string) ?? '',
      color: (g.color as string) ?? '',
      archived: (g.archived as boolean) ?? null,
      deleted: (g.deleted as boolean) ?? null,
      position: (g.position as string) ?? '',
    }))

    return {
      success: true,
      output: { groups, count: groups.length },
    }
  },

  outputs: {
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
    count: { type: 'number', description: 'Number of returned groups' },
  },
}
