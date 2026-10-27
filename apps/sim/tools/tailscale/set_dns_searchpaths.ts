import type {
  TailscaleSetDnsSearchpathsParams,
  TailscaleSetDnsSearchpathsResponse,
} from '@/tools/tailscale/types'
import { assertTailscaleResponse, parseTailscaleList } from '@/tools/tailscale/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const tailscaleSetDnsSearchpathsTool: ToolConfig<
  TailscaleSetDnsSearchpathsParams,
  TailscaleSetDnsSearchpathsResponse
> = {
  id: 'tailscale_set_dns_searchpaths',
  name: 'Tailscale Set DNS Search Paths',
  description: 'Replace the DNS search domains for the tailnet',
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
    searchPaths: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comma-separated DNS search domains; [] clears the search paths',
    },
  },
  request: {
    url: (params) =>
      `https://api.tailscale.com/api/v2/tailnet/${safeUrlPathSegment(params.tailnet, 'tailnet')}/dns/searchpaths`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey.trim()}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => ({ searchPaths: parseTailscaleList(params.searchPaths) }),
  },
  transformResponse: async (response) => {
    await assertTailscaleResponse(response)
    const data: { searchPaths: string[] } = await response.json()
    return { success: true, output: { searchPaths: data.searchPaths ?? [] } }
  },
  outputs: {
    searchPaths: {
      type: 'array',
      description: 'DNS search domain names',
      items: {
        type: 'string',
      },
    },
  },
}
