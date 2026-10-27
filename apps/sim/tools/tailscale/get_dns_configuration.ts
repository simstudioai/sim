import type {
  TailscaleBaseParams,
  TailscaleDnsConfiguration,
  TailscaleGetDnsConfigurationResponse,
} from '@/tools/tailscale/types'
import { assertTailscaleResponse } from '@/tools/tailscale/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const tailscaleGetDnsConfigurationTool: ToolConfig<
  TailscaleBaseParams,
  TailscaleGetDnsConfigurationResponse
> = {
  id: 'tailscale_get_dns_configuration',
  name: 'Tailscale Get DNS Configuration',
  description: 'Get tailnet DNS configuration',
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
      `https://api.tailscale.com/api/v2/tailnet/${safeUrlPathSegment(params.tailnet, 'tailnet')}/dns/configuration`,
    method: 'GET',
    headers: (params) => ({ Authorization: `Bearer ${params.apiKey.trim()}` }),
  },
  transformResponse: async (response) => {
    await assertTailscaleResponse(response)
    const data: TailscaleDnsConfiguration = await response.json()
    return {
      success: true,
      output: {
        dnsConfiguration: {
          nameservers: data.nameservers ?? [],
          splitDNS: data.splitDNS ?? null,
          searchPaths: data.searchPaths ?? [],
          preferences: data.preferences ?? null,
        },
      },
    }
  },
  outputs: {
    dnsConfiguration: {
      type: 'json',
      description: 'Dns configuration',
      properties: {
        nameservers: {
          type: 'array',
          description: 'Global DNS resolvers to use',
          items: {
            type: 'json',
            properties: {
              address: {
                type: 'string',
                description: 'IPv4 or IPv6 address of the DNS resolver',
                optional: true,
              },
              useWithExitNode: {
                type: 'boolean',
                description:
                  'If true, this resolver should still be used when a device is configured to use a Tailscale exit node',
                optional: true,
              },
            },
          },
        },
        splitDNS: {
          type: 'json',
          description:
            'Map of DNS name suffixes (domains) to lists of resolvers for Split DNS and advanced routing overlays',
          nullable: true,
        },
        searchPaths: {
          type: 'array',
          description: 'Search domain paths to apply',
          items: {
            type: 'string',
          },
        },
        preferences: {
          type: 'json',
          description: 'Preferences',
          properties: {
            overrideLocalDNS: {
              type: 'boolean',
              description:
                'If true, resolvers in `nameservers` override the local OS DNS configuration; if false, local resolvers are used',
              optional: true,
            },
            magicDNS: {
              type: 'boolean',
              description: 'Whether MagicDNS is enabled for this tailnet',
              optional: true,
            },
          },
          nullable: true,
        },
      },
    },
  },
}
