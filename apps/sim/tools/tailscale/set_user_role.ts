import type {
  TailscaleSetUserRoleParams,
  TailscaleSetUserRoleResponse,
} from '@/tools/tailscale/types'
import { assertTailscaleResponse } from '@/tools/tailscale/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const tailscaleSetUserRoleTool: ToolConfig<
  TailscaleSetUserRoleParams,
  TailscaleSetUserRoleResponse
> = {
  id: 'tailscale_set_user_role',
  name: 'Tailscale Set User Role',
  description: 'Change a tailnet user’s role',
  version: '1.0.0',
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description:
        'Tailscale API access token or OAuth access token (not an auth key or OAuth client secret)',
    },
    userId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Tailscale user ID',
    },
    role: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'User role: owner, member, admin, it-admin, network-admin, billing-admin, or auditor',
    },
  },
  request: {
    url: (params) =>
      `https://api.tailscale.com/api/v2/users/${safeUrlPathSegment(params.userId, 'userId')}/role`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey.trim()}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => ({ role: params.role }),
  },
  transformResponse: async (response, params) => {
    await assertTailscaleResponse(response)
    return {
      success: true,
      output: { success: true, userId: params?.userId ?? '', role: params?.role ?? '' },
    }
  },
  outputs: {
    success: {
      type: 'boolean',
      description: 'Whether the operation succeeded',
    },
    userId: {
      type: 'string',
      description: 'ID of the affected user',
    },
    role: {
      type: 'string',
      description: 'Requested user role',
    },
  },
}
