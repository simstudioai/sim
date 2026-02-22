import type { HexListGroupsParams, HexListGroupsResponse } from '@/tools/hex/types'
import type { ToolConfig } from '@/tools/types'

export const listGroupsTool: ToolConfig<HexListGroupsParams, HexListGroupsResponse> = {
  id: 'hex_list_groups',
  name: 'Hex List Groups',
  description: 'List all groups in the Hex workspace with optional sorting.',
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
      description: 'Maximum number of groups to return (1-500, default: 25)',
    },
    sortBy: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Sort by field: CREATED_AT or NAME',
    },
    sortDirection: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Sort direction: ASC or DESC',
    },
  },

  request: {
    url: (params) => {
      const searchParams = new URLSearchParams()
      if (params.limit) searchParams.set('limit', String(params.limit))
      if (params.sortBy) searchParams.set('sortBy', params.sortBy)
      if (params.sortDirection) searchParams.set('sortDirection', params.sortDirection)
      const qs = searchParams.toString()
      return `https://app.hex.tech/api/v1/groups${qs ? `?${qs}` : ''}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    const groups = Array.isArray(data) ? data : (data.values ?? [])

    return {
      success: true,
      output: {
        groups: groups.map((g: Record<string, unknown>) => ({
          id: (g.id as string) ?? null,
          name: (g.name as string) ?? null,
          createdAt: (g.createdAt as string) ?? null,
        })),
        total: groups.length,
      },
    }
  },

  outputs: {
    groups: {
      type: 'array',
      description: 'List of workspace groups',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Group UUID' },
          name: { type: 'string', description: 'Group name' },
          createdAt: { type: 'string', description: 'Creation timestamp' },
        },
      },
    },
    total: { type: 'number', description: 'Total number of groups returned' },
  },
}
