import type { HexCreateGroupParams, HexCreateGroupResponse } from '@/tools/hex/types'
import type { ToolConfig } from '@/tools/types'

export const createGroupTool: ToolConfig<HexCreateGroupParams, HexCreateGroupResponse> = {
  id: 'hex_create_group',
  name: 'Hex Create Group',
  description: 'Create a new group in the Hex workspace, optionally with initial members.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Hex API token (Personal or Workspace)',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name for the new group',
    },
    memberUserIds: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON array of user UUIDs to add as initial group members (e.g., ["uuid1", "uuid2"])',
    },
  },

  request: {
    url: 'https://app.hex.tech/api/v1/groups',
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = { name: params.name }
      if (params.memberUserIds) {
        let userIds: string[]
        try {
          userIds =
            typeof params.memberUserIds === 'string'
              ? JSON.parse(params.memberUserIds)
              : (params.memberUserIds as string[])
        } catch {
          throw new Error('memberUserIds must be a valid JSON array of user UUID strings')
        }
        body.members = { users: userIds.map((id) => ({ id: id.trim() })) }
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
    id: { type: 'string', description: 'Newly created group UUID' },
    name: { type: 'string', description: 'Group name' },
    createdAt: { type: 'string', description: 'Creation timestamp' },
  },
}
