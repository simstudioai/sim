import { isRecordLike } from '@sim/utils/object'
import type {
  CloudflareUpdateTunnelParams,
  CloudflareUpdateTunnelResponse,
} from '@/tools/cloudflare/operation-types'
import { TUNNEL_OUTPUTS } from '@/tools/cloudflare/outputs'
import {
  cloudflareErrorMessage,
  cloudflareHeaders,
  mapCloudflareFields,
  readCloudflareResponse,
} from '@/tools/cloudflare/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const updateTunnelTool: ToolConfig<
  CloudflareUpdateTunnelParams,
  CloudflareUpdateTunnelResponse
> = {
  id: 'cloudflare_update_tunnel',
  name: 'Cloudflare Update Tunnel',
  description: 'Updates the name or secret of an existing Cloudflare Tunnel.',
  version: '1.0.0',
  params: {
    accountId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Account id',
    },
    tunnelId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Tunnel id',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Cloudflare API token',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'A user-friendly name for a tunnel.',
    },
    tunnel_secret: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'Sets the password required to run a locally-managed tunnel. Must be at least 32 bytes and encoded as a base64 string.',
    },
  },
  request: {
    url: (params) =>
      `https://api.cloudflare.com/client/v4/accounts/${safeUrlPathSegment(params.accountId, 'accountId')}/cfd_tunnel/${safeUrlPathSegment(params.tunnelId, 'tunnelId')}`,
    method: 'PATCH',
    headers: (params) => ({ ...cloudflareHeaders(params.apiKey) }),
    body: (params) => ({ name: params.name, tunnel_secret: params.tunnel_secret }),
  },
  transformResponse: async (response) => {
    const data = await readCloudflareResponse(response)
    const success = response.ok && data.success === true && isRecordLike(data.result)
    return {
      success,
      output: mapCloudflareFields(data.result, TUNNEL_OUTPUTS),
      ...(!success ? { error: cloudflareErrorMessage(data, 'Failed to update tunnel') } : {}),
    }
  },
  outputs: TUNNEL_OUTPUTS,
}
