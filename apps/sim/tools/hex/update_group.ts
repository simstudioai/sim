import type { HexUpdateGroupParams, HexUpdateGroupResponse } from '@/tools/hex/types'
import type { ToolConfig } from '@/tools/types'

export const updateGroupTool: ToolConfig<HexUpdateGroupParams, HexUpdateGroupResponse> = {
  id: 'hex_update_group',
  name: 'Hex Update Group',
  description: 'Rename a Hex group or add/remove members from it.',
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
      description: 'The UUID of the group to update',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New name for the group',
    },
    addUserIds: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'JSON array of user UUIDs to add to the group (e.g., ["uuid1", "uuid2"])',
    },
    removeUserIds: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'JSON array of user UUIDs to remove from the group (e.g., ["uuid1", "uuid2"])',
    },
  },

  request: {
    url: (params) => `https://app.hex.tech/api/v1/groups/${params.groupId.trim()}`,
    method: 'PATCH',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {}
      if (params.name) body.name = params.name

      const parseIds = (value: unknown): string[] => {
        let parsed: unknown
        try {
          parsed = typeof value === 'string' ? JSON.parse(value) : value
        } catch {
          throw new Error(
            'addUserIds/removeUserIds must be a valid JSON array of user UUID strings'
          )
        }
        if (!Array.isArray(parsed)) {
          throw new Error(
            'addUserIds/removeUserIds must be a valid JSON array of user UUID strings'
          )
        }
        return parsed
      }

      if (params.addUserIds || params.removeUserIds) {
        const members: Record<string, unknown> = {}
        if (params.addUserIds) {
          members.add = { users: parseIds(params.addUserIds).map((id) => ({ id: id.trim() })) }
        }
        if (params.removeUserIds) {
          members.remove = {
            users: parseIds(params.removeUserIds).map((id) => ({ id: id.trim() })),
          }
        }
        body.members = members
      }

      return body
    },
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
