import type { HexDeleteGroupParams, HexDeleteGroupResponse } from '@/tools/hex/types'
import type { ToolConfig } from '@/tools/types'

export const deleteGroupTool: ToolConfig<HexDeleteGroupParams, HexDeleteGroupResponse> = {
  id: 'hex_delete_group',
  name: 'Hex Delete Group',
  description: 'Delete a group from the Hex workspace.',
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
      description: 'The UUID of the group to delete',
    },
  },

  request: {
    url: (params) => `https://app.hex.tech/api/v1/groups/${params.groupId.trim()}`,
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response, params) => {
    if (response.status === 204 || response.ok) {
      return {
        success: true,
        output: {
          success: true,
          groupId: params?.groupId ?? '',
        },
      }
    }

    const data = await response.json().catch(() => ({}))
    return {
      success: false,
      output: {
        success: false,
        groupId: params?.groupId ?? '',
      },
      error: (data as Record<string, string>).message ?? 'Failed to delete group',
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the group was successfully deleted' },
    groupId: { type: 'string', description: 'Group UUID that was deleted' },
  },
}
