import { isRecordLike } from '@sim/utils/object'
import { TUNNEL_OUTPUTS } from '@/tools/cloudflare/outputs'
import type { CloudflareGetTunnelParams, CloudflareTunnelResponse } from '@/tools/cloudflare/types'
import {
  cloudflareErrorMessage,
  cloudflareHeaders,
  mapCloudflareFields,
  readCloudflareResponse,
} from '@/tools/cloudflare/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const getTunnelTool: ToolConfig<CloudflareGetTunnelParams, CloudflareTunnelResponse> = {
  id: 'cloudflare_get_tunnel',
  name: 'Cloudflare Get Tunnel',
  description:
    'Reads a single Cloudflare Tunnel (cloudflared), including its health status and active connector connections. Requires an API token with Account Cloudflare Tunnel Read.',
  version: '1.0.0',

  params: {
    accountId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The Cloudflare account ID. Tunnels are account-scoped',
    },
    tunnelId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The tunnel ID to read',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Cloudflare API Token',
    },
  },

  request: {
    url: (params) =>
      `https://api.cloudflare.com/client/v4/accounts/${safeUrlPathSegment(params.accountId, 'accountId')}/cfd_tunnel/${safeUrlPathSegment(params.tunnelId, 'tunnelId')}`,
    method: 'GET',
    headers: (params) => cloudflareHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await readCloudflareResponse(response)
    const success = response.ok && data.success === true && isRecordLike(data.result)
    return {
      success,
      output: mapCloudflareFields(data.result, TUNNEL_OUTPUTS),
      ...(!success ? { error: cloudflareErrorMessage(data, 'Failed to get tunnel') } : {}),
    }
  },
  outputs: TUNNEL_OUTPUTS,
}
