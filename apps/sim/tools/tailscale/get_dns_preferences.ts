import type { ToolConfig, ToolResponse } from '@/tools/types'
import type { TailscaleBaseParams } from './types'

interface TailscaleGetDnsPreferencesResponse extends ToolResponse {
  output: {
    magicDNS: boolean
  }
}

export const tailscaleGetDnsPreferencesTool: ToolConfig<
  TailscaleBaseParams,
  TailscaleGetDnsPreferencesResponse
> = {
  id: 'tailscale_get_dns_preferences',
  name: 'Tailscale Get DNS Preferences',
  description: 'Get the DNS preferences for the tailnet including MagicDNS status',
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
      `https://api.tailscale.com/api/v2/tailnet/${encodeURIComponent(params.tailnet.trim())}/dns/preferences`,
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
        output: { magicDNS: false },
        error: (data as Record<string, string>).message ?? 'Failed to get DNS preferences',
      }
    }

    const data = await response.json()
    return {
      success: true,
      output: {
        magicDNS: data.magicDNS ?? false,
      },
    }
  },

  outputs: {
    magicDNS: { type: 'boolean', description: 'Whether MagicDNS is enabled' },
  },
}
