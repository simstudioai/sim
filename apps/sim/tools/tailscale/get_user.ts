import { USER_OUTPUT_PROPERTIES } from '@/tools/tailscale/outputs'
import type {
  TailscaleGetUserResponse,
  TailscaleUser,
  TailscaleUserParams,
} from '@/tools/tailscale/types'
import { assertTailscaleResponse, mapTailscaleUser } from '@/tools/tailscale/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const tailscaleGetUserTool: ToolConfig<TailscaleUserParams, TailscaleGetUserResponse> = {
  id: 'tailscale_get_user',
  name: 'Tailscale Get User',
  description: 'Get details of a specific user',
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
      `https://api.tailscale.com/api/v2/users/${safeUrlPathSegment(params.userId, 'userId')}`,
    method: 'GET',
    headers: (params) => ({ Authorization: `Bearer ${params.apiKey.trim()}` }),
  },
  transformResponse: async (response) => {
    await assertTailscaleResponse(response)
    const data: TailscaleUser = await response.json()
    return { success: true, output: mapTailscaleUser(data) }
  },
  outputs: USER_OUTPUT_PROPERTIES,
}
