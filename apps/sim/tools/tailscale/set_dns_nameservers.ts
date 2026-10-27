import type {
  TailscaleSetDnsNameserversParams,
  TailscaleSetDnsNameserversResponse,
} from '@/tools/tailscale/types'
import { assertTailscaleResponse, parseTailscaleList } from '@/tools/tailscale/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const tailscaleSetDnsNameserversTool: ToolConfig<
  TailscaleSetDnsNameserversParams,
  TailscaleSetDnsNameserversResponse
> = {
  id: 'tailscale_set_dns_nameservers',
  name: 'Tailscale Set DNS Nameservers',
  description: 'Replace the global DNS nameservers for the tailnet',
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
    dns: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comma-separated DNS nameserver IP addresses; [] clears the nameservers',
    },
  },
  request: {
    url: (params) =>
      `https://api.tailscale.com/api/v2/tailnet/${safeUrlPathSegment(params.tailnet, 'tailnet')}/dns/nameservers`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey.trim()}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => ({ dns: parseTailscaleList(params.dns) }),
  },
  transformResponse: async (response) => {
    await assertTailscaleResponse(response)
    const data: { dns: string[]; magicDNS: boolean } = await response.json()
    return { success: true, output: { dns: data.dns ?? [], magicDNS: data.magicDNS ?? false } }
  },
  outputs: {
    dns: {
      type: 'array',
      description: 'DNS nameserver IP addresses',
      items: {
        type: 'string',
      },
    },
    magicDNS: {
      type: 'boolean',
      description: 'Whether MagicDNS is enabled',
    },
  },
}
