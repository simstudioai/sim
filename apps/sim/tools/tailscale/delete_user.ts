import type { TailscaleDeleteUserResponse, TailscaleUserParams } from '@/tools/tailscale/types'
import { assertTailscaleResponse } from '@/tools/tailscale/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const tailscaleDeleteUserTool: ToolConfig<TailscaleUserParams, TailscaleDeleteUserResponse> =
  {
    id: 'tailscale_delete_user',
    name: 'Tailscale Delete User',
    description: 'Delete a user from the tailnet',
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
        `https://api.tailscale.com/api/v2/users/${safeUrlPathSegment(params.userId, 'userId')}/delete`,
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
