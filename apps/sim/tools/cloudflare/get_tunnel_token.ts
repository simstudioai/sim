import type {
  CloudflareGetTunnelTokenParams,
  CloudflareGetTunnelTokenResponse,
} from '@/tools/cloudflare/operation-types'
import {
  cloudflareErrorMessage,
  cloudflareHeaders,
  readCloudflareResponse,
} from '@/tools/cloudflare/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const getTunnelTokenTool: ToolConfig<
  CloudflareGetTunnelTokenParams,
  CloudflareGetTunnelTokenResponse
> = {
  id: 'cloudflare_get_tunnel_token',
  name: 'Cloudflare Get Tunnel Token',
  description:
    'Gets the connector token used to run a remotely managed Cloudflare Tunnel with cloudflared.',
  version: '1.0.0',
  params: {
    accountId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Cloudflare account ID',
    },
    tunnelId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Cloudflare Tunnel ID',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Cloudflare API token',
    },
  },
  request: {
    url: (params) =>
      `https://api.cloudflare.com/client/v4/accounts/${safeUrlPathSegment(params.accountId, 'accountId')}/cfd_tunnel/${safeUrlPathSegment(params.tunnelId, 'tunnelId')}/token`,
    method: 'GET',
    headers: (params) => cloudflareHeaders(params.apiKey),
  },
  transformResponse: async (response) => {
    const data = await readCloudflareResponse<string>(response)
    const success = response.ok && data.success === true && typeof data.result === 'string'
    return {
      success,
      output: { token: typeof data.result === 'string' ? data.result : null },
      ...(!success ? { error: cloudflareErrorMessage(data, 'Failed to get tunnel token') } : {}),
    }
  },
  outputs: {
    token: {
      type: 'string',
      nullable: true,
      description: 'Token for connecting cloudflared to the tunnel',
    },
  },
}
