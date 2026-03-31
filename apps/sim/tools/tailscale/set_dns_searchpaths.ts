import type { ToolConfig, ToolResponse } from '@/tools/types'

interface TailscaleSetDnsSearchpathsParams {
  apiKey: string
  tailnet: string
  searchPaths: string
}

interface TailscaleSetDnsSearchpathsResponse extends ToolResponse {
  output: {
    searchPaths: string[]
  }
}

export const tailscaleSetDnsSearchpathsTool: ToolConfig<
  TailscaleSetDnsSearchpathsParams,
  TailscaleSetDnsSearchpathsResponse
> = {
  id: 'tailscale_set_dns_searchpaths',
  name: 'Tailscale Set DNS Search Paths',
  description: 'Set the DNS search paths for the tailnet',
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
    searchPaths: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Comma-separated list of DNS search path domains (e.g., "corp.example.com,internal.example.com")',
    },
  },

  request: {
    url: (params) =>
      `https://api.tailscale.com/api/v2/tailnet/${encodeURIComponent(params.tailnet.trim())}/dns/searchpaths`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey.trim()}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      searchPaths: params.searchPaths
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
        output: { searchPaths: [] },
        error: (data as Record<string, string>).message ?? 'Failed to set DNS search paths',
      }
    }

    const data = await response.json()
    return {
      success: true,
      output: {
        searchPaths: data.searchPaths ?? [],
      },
    }
  },

  outputs: {
    searchPaths: { type: 'array', description: 'Updated list of DNS search path domains' },
  },
}
