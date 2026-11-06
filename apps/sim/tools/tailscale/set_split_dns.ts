import { isRecordLike } from '@sim/utils/object'
import type {
  TailscaleSetSplitDnsParams,
  TailscaleSetSplitDnsResponse,
} from '@/tools/tailscale/types'
import { assertTailscaleResponse } from '@/tools/tailscale/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const tailscaleSetSplitDnsTool: ToolConfig<
  TailscaleSetSplitDnsParams,
  TailscaleSetSplitDnsResponse
> = {
  id: 'tailscale_set_split_dns',
  name: 'Tailscale Set Split DNS',
  description: 'Replace all split DNS resolvers',
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
    splitDns: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'JSON map of domains to nameserver arrays; null deletes a domain when updating',
    },
  },
  request: {
    url: (params) =>
      `https://api.tailscale.com/api/v2/tailnet/${safeUrlPathSegment(params.tailnet, 'tailnet')}/dns/split-dns`,
    method: 'PUT',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey.trim()}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const value: unknown = JSON.parse(params.splitDns)
      if (
        !isRecordLike(value) ||
        !Object.values(value).every(
          (resolvers) =>
            resolvers === null ||
            (Array.isArray(resolvers) &&
              resolvers.every((resolver) => typeof resolver === 'string'))
        )
      )
        throw new Error('Split DNS must map domains to arrays of nameserver addresses or null')
      return value
    },
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
