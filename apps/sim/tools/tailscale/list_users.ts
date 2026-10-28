import { USER_OUTPUT_PROPERTIES } from '@/tools/tailscale/outputs'
import type {
  TailscaleListUsersParams,
  TailscaleListUsersResponse,
  TailscaleUser,
} from '@/tools/tailscale/types'
import { assertTailscaleResponse, mapTailscaleUser } from '@/tools/tailscale/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const tailscaleListUsersTool: ToolConfig<
  TailscaleListUsersParams,
  TailscaleListUsersResponse
> = {
  id: 'tailscale_list_users',
  name: 'Tailscale List Users',
  description: 'List users in the tailnet',
  version: '1.0.0',
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description:
        'Tailscale API access token or OAuth access token (not an auth key or OAuth client secret)',
    },
    tailnet: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Tailnet ID, legacy name, or "-" for the token’s default tailnet',
    },
    userType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'User relationship: member (default), shared, or all',
    },
    role: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'User role: owner, member, admin, it-admin, network-admin, billing-admin, or auditor',
    },
  },
  request: {
    url: (params) => {
      const query = new URLSearchParams()
      if (params.userType) query.set('type', params.userType)
      if (params.role) query.set('role', params.role)
      return `https://api.tailscale.com/api/v2/tailnet/${safeUrlPathSegment(params.tailnet, 'tailnet')}/users${query.size ? `?${query}` : ''}`
    },
    method: 'GET',
    headers: (params) => ({ Authorization: `Bearer ${params.apiKey.trim()}` }),
  },
  transformResponse: async (response) => {
    await assertTailscaleResponse(response)
    const data: { users?: TailscaleUser[] } = await response.json()
    const users = (data.users ?? []).map(mapTailscaleUser)
    return { success: true, output: { users, count: users.length } }
  },
  outputs: {
    users: {
      type: 'array',
      description: 'Users in the tailnet',
      items: { type: 'object', properties: USER_OUTPUT_PROPERTIES },
    },
    count: { type: 'number', description: 'Number of returned items' },
  },
}
