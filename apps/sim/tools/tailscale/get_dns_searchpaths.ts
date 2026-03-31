import type { ToolConfig, ToolResponse } from '@/tools/types'
import type { TailscaleBaseParams } from './types'

interface TailscaleGetDnsSearchpathsResponse extends ToolResponse {
  output: {
    searchPaths: string[]
  }
}

export const tailscaleGetDnsSearchpathsTool: ToolConfig<
  TailscaleBaseParams,
  TailscaleGetDnsSearchpathsResponse
> = {
  id: 'tailscale_get_dns_searchpaths',
  name: 'Tailscale Get DNS Search Paths',
  description: 'Get the DNS search paths configured for the tailnet',
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
      `https://api.tailscale.com/api/v2/tailnet/${encodeURIComponent(params.tailnet.trim())}/dns/searchpaths`,
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        output: { searchPaths: [] },
        error: data.message ?? 'Failed to get DNS search paths',
      }
    }

    return {
      success: true,
      output: {
        searchPaths: data.searchPaths ?? [],
      },
    }
  },

  outputs: {
    searchPaths: { type: 'array', description: 'List of DNS search path domains' },
  },
}
