import type { ToolConfig, ToolResponse } from '@/tools/types'

interface TailscaleSetDnsNameserversParams {
  apiKey: string
  tailnet: string
  dns: string
}

interface TailscaleSetDnsNameserversResponse extends ToolResponse {
  output: {
    dns: string[]
    magicDNS: boolean
  }
}

export const tailscaleSetDnsNameserversTool: ToolConfig<
  TailscaleSetDnsNameserversParams,
  TailscaleSetDnsNameserversResponse
> = {
  id: 'tailscale_set_dns_nameservers',
  name: 'Tailscale Set DNS Nameservers',
  description: 'Set the DNS nameservers for the tailnet',
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
    dns: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of DNS nameserver IP addresses (e.g., "8.8.8.8,8.8.4.4")',
    },
  },

  request: {
    url: (params) =>
      `https://api.tailscale.com/api/v2/tailnet/${encodeURIComponent(params.tailnet.trim())}/dns/nameservers`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey.trim()}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      dns: params.dns
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    }),
  },

  transformResponse: async (response) => {
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      return {
        success: false,
        output: { dns: [], magicDNS: false },
        error: (data as Record<string, string>).message ?? 'Failed to set DNS nameservers',
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
    dns: { type: 'array', description: 'Updated list of DNS nameserver addresses' },
    magicDNS: { type: 'boolean', description: 'Whether MagicDNS is enabled' },
  },
}
