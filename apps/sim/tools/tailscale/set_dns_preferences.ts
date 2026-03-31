import type { ToolConfig, ToolResponse } from '@/tools/types'

interface TailscaleSetDnsPreferencesParams {
  apiKey: string
  tailnet: string
  magicDNS: boolean
}

interface TailscaleSetDnsPreferencesResponse extends ToolResponse {
  output: {
    magicDNS: boolean
  }
}

export const tailscaleSetDnsPreferencesTool: ToolConfig<
  TailscaleSetDnsPreferencesParams,
  TailscaleSetDnsPreferencesResponse
> = {
  id: 'tailscale_set_dns_preferences',
  name: 'Tailscale Set DNS Preferences',
  description: 'Set DNS preferences for the tailnet (enable/disable MagicDNS)',
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
    magicDNS: {
      type: 'boolean',
      required: true,
      visibility: 'user-or-llm',
      description: 'Whether to enable (true) or disable (false) MagicDNS',
    },
  },

  request: {
    url: (params) =>
      `https://api.tailscale.com/api/v2/tailnet/${encodeURIComponent(params.tailnet.trim())}/dns/preferences`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey.trim()}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      magicDNS: params.magicDNS,
    }),
  },

  transformResponse: async (response) => {
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      return {
        success: false,
        output: { magicDNS: false },
        error: (data as Record<string, string>).message ?? 'Failed to set DNS preferences',
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
    magicDNS: { type: 'boolean', description: 'Updated MagicDNS status' },
  },
}
