import type {
  TailscaleBaseParams,
  TailscaleGetDnsPreferencesResponse,
} from '@/tools/tailscale/types'
import { assertTailscaleResponse } from '@/tools/tailscale/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const tailscaleGetDnsPreferencesTool: ToolConfig<
  TailscaleBaseParams,
  TailscaleGetDnsPreferencesResponse
> = {
  id: 'tailscale_get_dns_preferences',
  name: 'Tailscale Get DNS Preferences',
  description: 'Get the MagicDNS preference for the tailnet',
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
      `https://api.tailscale.com/api/v2/tailnet/${safeUrlPathSegment(params.tailnet, 'tailnet')}/dns/preferences`,
    method: 'GET',
    headers: (params) => ({ Authorization: `Bearer ${params.apiKey.trim()}` }),
  },
  transformResponse: async (response) => {
    await assertTailscaleResponse(response)
    const data: { magicDNS: boolean } = await response.json()
    return { success: true, output: { magicDNS: data.magicDNS ?? false } }
  },
  outputs: {
    magicDNS: {
      type: 'boolean',
      description: 'Whether MagicDNS is enabled',
    },
  },
}
