import type { TailscaleBaseParams, TailscaleGetSplitDnsResponse } from '@/tools/tailscale/types'
import { assertTailscaleResponse } from '@/tools/tailscale/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const tailscaleGetSplitDnsTool: ToolConfig<
  TailscaleBaseParams,
  TailscaleGetSplitDnsResponse
> = {
  id: 'tailscale_get_split_dns',
  name: 'Tailscale Get Split DNS',
  description: 'Get split DNS resolvers',
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
  },
  request: {
    url: (params) =>
      `https://api.tailscale.com/api/v2/tailnet/${safeUrlPathSegment(params.tailnet, 'tailnet')}/dns/split-dns`,
    method: 'GET',
    headers: (params) => ({ Authorization: `Bearer ${params.apiKey.trim()}` }),
  },
  transformResponse: async (response) => {
    await assertTailscaleResponse(response)
    const splitDns: Record<string, string[] | null> = await response.json()
    return { success: true, output: { splitDns } }
  },
  outputs: {
    splitDns: {
      type: 'json',
      description: 'Map of domain names to DNS resolver arrays or null',
    },
  },
}
