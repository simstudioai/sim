import type {
  TailscaleBaseParams,
  TailscaleListDnsNameserversResponse,
} from '@/tools/tailscale/types'
import { assertTailscaleResponse } from '@/tools/tailscale/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const tailscaleListDnsNameserversTool: ToolConfig<
  TailscaleBaseParams,
  TailscaleListDnsNameserversResponse
> = {
  id: 'tailscale_list_dns_nameservers',
  name: 'Tailscale List DNS Nameservers',
  description: 'Get the global DNS nameservers configured for the tailnet',
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
      `https://api.tailscale.com/api/v2/tailnet/${safeUrlPathSegment(params.tailnet, 'tailnet')}/dns/nameservers`,
    method: 'GET',
    headers: (params) => ({ Authorization: `Bearer ${params.apiKey.trim()}` }),
  },
  transformResponse: async (response) => {
    await assertTailscaleResponse(response)
    const data: { dns: string[] } = await response.json()
    return { success: true, output: { dns: data.dns ?? [] } }
  },
  outputs: {
    dns: {
      type: 'array',
      description: 'DNS nameserver IP addresses',
      items: {
        type: 'string',
      },
    },
  },
}
