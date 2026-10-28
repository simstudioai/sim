import { isRecordLike } from '@sim/utils/object'
import type {
  CloudflareCreateTunnelParams,
  CloudflareCreateTunnelResponse,
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

export const createTunnelTool: ToolConfig<
  CloudflareCreateTunnelParams,
  CloudflareCreateTunnelResponse
> = {
  id: 'cloudflare_create_tunnel',
  name: 'Cloudflare Create Tunnel',
  description:
    'Creates a remotely or locally managed Cloudflare Tunnel in an account. After creation, retrieve its token and run cloudflared to establish the connector connection.',
  version: '1.0.0',
  params: {
    accountId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Account id',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Cloudflare API token',
    },
    config_src: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Indicates if this is a locally or remotely configured tunnel. If `local`, manage the tunnel using a YAML file on the origin machine. If `cloudflare`, manage the tunnel on the Zero Trust dashboard. Allowed values: local, cloudflare.',
    },
    name: {
      type: 'string',
      required: true,
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
      `https://api.cloudflare.com/client/v4/accounts/${safeUrlPathSegment(params.accountId, 'accountId')}/cfd_tunnel`,
    method: 'POST',
    headers: (params) => ({ ...cloudflareHeaders(params.apiKey) }),
    body: (params) => ({
      config_src: params.config_src,
      name: params.name,
      tunnel_secret: params.tunnel_secret,
    }),
  },
  transformResponse: async (response) => {
    const data = await readCloudflareResponse(response)
    const success = response.ok && data.success === true && isRecordLike(data.result)
    return {
      success,
      output: mapCloudflareFields(data.result, TUNNEL_OUTPUTS),
      ...(!success ? { error: cloudflareErrorMessage(data, 'Failed to create tunnel') } : {}),
    }
  },
  outputs: TUNNEL_OUTPUTS,
}
