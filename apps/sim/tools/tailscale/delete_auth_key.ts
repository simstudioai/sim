import type {
  TailscaleAuthKeyParams,
  TailscaleDeleteAuthKeyResponse,
} from '@/tools/tailscale/types'
import { assertTailscaleResponse } from '@/tools/tailscale/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const tailscaleDeleteAuthKeyTool: ToolConfig<
  TailscaleAuthKeyParams,
  TailscaleDeleteAuthKeyResponse
> = {
  id: 'tailscale_delete_auth_key',
  name: 'Tailscale Delete Auth Key',
  description: 'Revoke an auth key, API access token, or trust credential',
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
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey.trim()}`,
      'Content-Type': 'application/json',
    }),
  },
  transformResponse: async (response, params) => {
    await assertTailscaleResponse(response)
    return { success: true, output: { success: true, keyId: params?.keyId ?? '' } }
  },
  outputs: {
    success: {
      type: 'boolean',
      description: 'Whether the operation succeeded',
    },
    keyId: {
      type: 'string',
      description: 'ID of the revoked key',
    },
  },
}
