import type { TailscaleApproveUserResponse, TailscaleUserParams } from '@/tools/tailscale/types'
import { assertTailscaleResponse } from '@/tools/tailscale/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const tailscaleApproveUserTool: ToolConfig<
  TailscaleUserParams,
  TailscaleApproveUserResponse
> = {
  id: 'tailscale_approve_user',
  name: 'Tailscale Approve User',
  description: 'Approve a pending user to join the tailnet',
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
  },
  request: {
    url: (params) =>
      `https://api.tailscale.com/api/v2/users/${safeUrlPathSegment(params.userId, 'userId')}/approve`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey.trim()}`,
      'Content-Type': 'application/json',
    }),
  },
  transformResponse: async (response, params) => {
    await assertTailscaleResponse(response)
    return { success: true, output: { success: true, userId: params?.userId ?? '' } }
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
  },
}
