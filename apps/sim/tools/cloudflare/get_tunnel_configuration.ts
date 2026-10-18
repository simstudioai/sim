import { isRecordLike } from '@sim/utils/object'
import { TUNNEL_CONFIGURATION_OUTPUTS } from '@/tools/cloudflare/outputs'
import type {
  CloudflareGetTunnelConfigurationParams,
  CloudflareGetTunnelConfigurationResponse,
} from '@/tools/cloudflare/types'
import {
  cloudflareErrorMessage,
  cloudflareHeaders,
  mapCloudflareFields,
  readCloudflareResponse,
} from '@/tools/cloudflare/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const getTunnelConfigurationTool: ToolConfig<
  CloudflareGetTunnelConfigurationParams,
  CloudflareGetTunnelConfigurationResponse
> = {
  id: 'cloudflare_get_tunnel_configuration',
  name: 'Cloudflare Get Tunnel Configuration',
  description:
    'Reads the configuration of a remotely-managed Cloudflare Tunnel — its ingress rules, origin request settings, and WARP routing. Only tunnels whose configuration source is "cloudflare" have a remote configuration; locally-managed tunnels keep it in their own config file. Requires an API token with Account Cloudflare Tunnel Read.',
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
      description: 'The tunnel ID to read the configuration for',
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
      `https://api.cloudflare.com/client/v4/accounts/${safeUrlPathSegment(params.accountId, 'accountId')}/cfd_tunnel/${safeUrlPathSegment(params.tunnelId, 'tunnelId')}/configurations`,
    method: 'GET',
    headers: (params) => cloudflareHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await readCloudflareResponse(response)
    const success = response.ok && data.success === true && isRecordLike(data.result)
    return {
      success,
      output: mapCloudflareFields(data.result, TUNNEL_CONFIGURATION_OUTPUTS),
      ...(!success
        ? { error: cloudflareErrorMessage(data, 'Failed to get tunnel configuration') }
        : {}),
    }
  },
  outputs: TUNNEL_CONFIGURATION_OUTPUTS,
}
