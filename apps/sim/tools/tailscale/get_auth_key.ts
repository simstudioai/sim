import { KEY_OUTPUT_PROPERTIES } from '@/tools/tailscale/outputs'
import type {
  TailscaleAuthKeyParams,
  TailscaleGetAuthKeyResponse,
  TailscaleKey,
} from '@/tools/tailscale/types'
import { assertTailscaleResponse, mapTailscaleKey } from '@/tools/tailscale/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const tailscaleGetAuthKeyTool: ToolConfig<
  TailscaleAuthKeyParams,
  TailscaleGetAuthKeyResponse
> = {
  id: 'tailscale_get_auth_key',
  name: 'Tailscale Get Auth Key',
  description: 'Get a key’s type, owner, scopes, expiry, and device enrollment capabilities',
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
    keyId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Tailscale key ID',
    },
  },
  request: {
    url: (params) =>
      `https://api.tailscale.com/api/v2/tailnet/${safeUrlPathSegment(params.tailnet, 'tailnet')}/keys/${safeUrlPathSegment(params.keyId, 'keyId')}`,
    method: 'GET',
    headers: (params) => ({ Authorization: `Bearer ${params.apiKey.trim()}` }),
  },
  transformResponse: async (response) => {
    await assertTailscaleResponse(response)
    const data: TailscaleKey = await response.json()
    return { success: true, output: mapTailscaleKey(data) }
  },
  outputs: KEY_OUTPUT_PROPERTIES,
}
