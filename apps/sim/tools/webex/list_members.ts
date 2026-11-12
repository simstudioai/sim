import type { ToolConfig } from '@/tools/types'
import type { WebexListMembersParams, WebexListMembersResponse } from '@/tools/webex/types'
import { MEMBERSHIPS_LIST_OUTPUT } from '@/tools/webex/types'

export const webexListMembersTool: ToolConfig<WebexListMembersParams, WebexListMembersResponse> = {
  id: 'webex_list_members',
  name: 'Webex List Members',
  description: 'List members (memberships) in a Webex room.',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'webex',
    requiredScopes: ['spark:memberships_read'],
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token for Webex API',
    },
    roomId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The room ID to list members for',
    },
    personEmail: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by person email address',
    },
    max: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of members to return',
    },
  },

  request: {
    url: (params) => {
      const query = new URLSearchParams({ roomId: params.roomId })
      if (params.personEmail) query.set('personEmail', params.personEmail)
      if (params.max) query.set('max', String(params.max))
      return `https://webexapis.com/v1/memberships?${query.toString()}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response) => {
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      return {
        success: false,
        error:
          (errorData as { message?: string }).message ||
          `Webex API error: ${response.status} ${response.statusText}`,
        output: { members: [] },
      }
    }
    const data = await response.json()
    return { success: true, output: { members: data.items ?? [] } }
  },

  outputs: { members: MEMBERSHIPS_LIST_OUTPUT },
}
