import { isRecordLike } from '@sim/utils/object'
import { DNS_CONFIGURATION_OUTPUT } from '@/tools/tailscale/outputs'
import type {
  TailscaleDnsConfiguration,
  TailscaleSetDnsConfigurationParams,
  TailscaleSetDnsConfigurationResponse,
} from '@/tools/tailscale/types'
import { assertTailscaleResponse, mapTailscaleDnsConfiguration } from '@/tools/tailscale/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const tailscaleSetDnsConfigurationTool: ToolConfig<
  TailscaleSetDnsConfigurationParams,
  TailscaleSetDnsConfigurationResponse
> = {
  id: 'tailscale_set_dns_configuration',
  name: 'Tailscale Set DNS Configuration',
  description: 'Replace the full tailnet DNS configuration',
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
    dnsConfiguration: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Complete DNS configuration JSON: nameservers, splitDNS, searchPaths, preferences',
    },
  },
  request: {
    url: (params) =>
      `https://api.tailscale.com/api/v2/tailnet/${safeUrlPathSegment(params.tailnet, 'tailnet')}/dns/configuration`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey.trim()}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const value: unknown = JSON.parse(params.dnsConfiguration)
      if (!isRecordLike(value)) throw new Error('dnsConfiguration must be a JSON object')
      return value
    },
  },
  transformResponse: async (response) => {
    await assertTailscaleResponse(response)
    const data: TailscaleDnsConfiguration = await response.json()
    return {
      success: true,
      output: {
        dnsConfiguration: mapTailscaleDnsConfiguration(data),
      },
    }
  },
  outputs: DNS_CONFIGURATION_OUTPUT,
}
