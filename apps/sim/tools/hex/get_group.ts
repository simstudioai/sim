import type { HexGetGroupParams, HexGetGroupResponse } from '@/tools/hex/types'
import { HEX_HOST_PARAM, hexApiBase } from '@/tools/hex/utils'
import { HEX_CREDENTIAL_OAUTH } from '@/tools/shared/saved-credentials'
import type { ToolConfig } from '@/tools/types'

export const getGroupTool: ToolConfig<HexGetGroupParams, HexGetGroupResponse> = {
  id: 'hex_get_group',
  name: 'Hex Get Group',
  description: 'Retrieve details for a specific Hex group.',
  version: '1.0.0',
  oauth: HEX_CREDENTIAL_OAUTH,

  params: {
    host: HEX_HOST_PARAM,
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
    url: (params) => `${hexApiBase(params.host)}/groups/${params.groupId.trim()}`,
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
