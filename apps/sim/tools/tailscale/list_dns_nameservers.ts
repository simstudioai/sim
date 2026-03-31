import type { ToolConfig } from '@/tools/types'
import type { TailscaleBaseParams, TailscaleListDnsNameserversResponse } from './types'

export const tailscaleListDnsNameserversTool: ToolConfig<
  TailscaleBaseParams,
  TailscaleListDnsNameserversResponse
> = {
  id: 'tailscale_list_dns_nameservers',
  name: 'Tailscale List DNS Nameservers',
  description: 'Get the DNS nameservers configured for the tailnet',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Tailscale API key',
    },
    tailnet: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Tailnet name (e.g., example.com) or "-" for default',
    },
  },

  request: {
    url: (params) =>
      `https://api.tailscale.com/api/v2/tailnet/${encodeURIComponent(params.tailnet.trim())}/dns/nameservers`,
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey.trim()}`,
    }),
  },

  transformResponse: async (response) => {
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      return {
        success: false,
        output: { dns: [], magicDNS: false },
        error: (data as Record<string, string>).message ?? 'Failed to list DNS nameservers',
      }
    }

    const data = await response.json()
    return {
      success: true,
      output: {
        dns: data.dns ?? [],
        magicDNS: data.magicDNS ?? false,
      },
    }
  },

  outputs: {
    dns: { type: 'array', description: 'List of DNS nameserver addresses' },
    magicDNS: { type: 'boolean', description: 'Whether MagicDNS is enabled' },
  },
}
