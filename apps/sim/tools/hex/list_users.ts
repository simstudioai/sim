import type { HexListUsersParams, HexListUsersResponse } from '@/tools/hex/types'
import type { ToolConfig } from '@/tools/types'

export const listUsersTool: ToolConfig<HexListUsersParams, HexListUsersResponse> = {
  id: 'hex_list_users',
  name: 'Hex List Users',
  description: 'List all users in the Hex workspace with optional filtering and sorting.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Hex API token (Personal or Workspace)',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of users to return (1-100, default: 25)',
    },
    sortBy: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Sort by field: NAME or EMAIL',
    },
    sortDirection: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Sort direction: ASC or DESC',
    },
    groupId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter users by group UUID',
    },
  },

  request: {
    url: (params) => {
      const searchParams = new URLSearchParams()
      if (params.limit) searchParams.set('limit', String(params.limit))
      if (params.sortBy) searchParams.set('sortBy', params.sortBy)
      if (params.sortDirection) searchParams.set('sortDirection', params.sortDirection)
      if (params.groupId) searchParams.set('groupId', params.groupId)
      const qs = searchParams.toString()
      return `https://app.hex.tech/api/v1/users${qs ? `?${qs}` : ''}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    const users = Array.isArray(data) ? data : (data.values ?? [])

    return {
      success: true,
      output: {
        users: users.map((u: Record<string, unknown>) => ({
          id: (u.id as string) ?? null,
          name: (u.name as string) ?? null,
          email: (u.email as string) ?? null,
          role: (u.role as string) ?? null,
        })),
        total: users.length,
      },
    }
  },

  outputs: {
    users: {
      type: 'array',
      description: 'List of workspace users',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'User UUID' },
          name: { type: 'string', description: 'User name' },
          email: { type: 'string', description: 'User email' },
          role: {
            type: 'string',
            description:
              'User role (ADMIN, MANAGER, EDITOR, EXPLORER, MEMBER, GUEST, EMBEDDED_USER, ANONYMOUS)',
          },
        },
      },
    },
    total: { type: 'number', description: 'Total number of users returned' },
  },
}
