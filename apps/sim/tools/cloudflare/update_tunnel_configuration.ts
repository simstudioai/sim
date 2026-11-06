import { isRecordLike } from '@sim/utils/object'
import type {
  CloudflareUpdateTunnelConfigurationParams,
  CloudflareUpdateTunnelConfigurationResponse,
} from '@/tools/cloudflare/operation-types'
import { TUNNEL_CONFIGURATION_OUTPUTS } from '@/tools/cloudflare/outputs'
import {
  cloudflareErrorMessage,
  cloudflareHeaders,
  mapCloudflareFields,
  parseJsonObjectParam,
  readCloudflareResponse,
} from '@/tools/cloudflare/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const updateTunnelConfigurationTool: ToolConfig<
  CloudflareUpdateTunnelConfigurationParams,
  CloudflareUpdateTunnelConfigurationResponse
> = {
  id: 'cloudflare_update_tunnel_configuration',
  name: 'Cloudflare Update Tunnel Configuration',
  description:
    'Replaces the configuration for a remotely managed Cloudflare Tunnel, including its ingress rules and origin request settings. Replaces the configuration; resend all values to retain.',
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
    config: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON object. The tunnel configuration and ingress rules. Fields: ingress, originRequest, warp-routing.',
    },
  },
  request: {
    url: (params) =>
      `https://api.cloudflare.com/client/v4/accounts/${safeUrlPathSegment(params.accountId, 'accountId')}/cfd_tunnel/${safeUrlPathSegment(params.tunnelId, 'tunnelId')}/configurations`,
    method: 'PUT',
    headers: (params) => ({ ...cloudflareHeaders(params.apiKey) }),
    body: (params) => ({ config: parseJsonObjectParam(params.config, 'config') }),
  },
  transformResponse: async (response) => {
    const data = await readCloudflareResponse(response)
    const success = response.ok && data.success === true && isRecordLike(data.result)
    return {
      success,
      output: mapCloudflareFields(data.result, TUNNEL_CONFIGURATION_OUTPUTS),
      ...(!success
        ? { error: cloudflareErrorMessage(data, 'Failed to update tunnel configuration') }
        : {}),
    }
  },
  outputs: TUNNEL_CONFIGURATION_OUTPUTS,
}
