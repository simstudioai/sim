import type { HexGetGroupParams, HexGetGroupResponse } from '@/tools/hex/types'
import type { ToolConfig } from '@/tools/types'

export const getGroupTool: ToolConfig<HexGetGroupParams, HexGetGroupResponse> = {
  id: 'hex_get_group',
  name: 'Hex Get Group',
  description: 'Retrieve details for a specific Hex group.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Hex API token (Personal or Workspace)',
    },
    groupId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The UUID of the group',
    },
  },

  request: {
    url: (params) => `https://app.hex.tech/api/v1/groups/${params.groupId}`,
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        id: data.id ?? null,
        name: data.name ?? null,
        createdAt: data.createdAt ?? null,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Group UUID' },
    name: { type: 'string', description: 'Group name' },
    createdAt: { type: 'string', description: 'Creation timestamp' },
  },
}
