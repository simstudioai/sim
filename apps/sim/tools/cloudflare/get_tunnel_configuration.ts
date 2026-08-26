import type {
  CloudflareGetTunnelConfigurationParams,
  CloudflareGetTunnelConfigurationResponse,
} from '@/tools/cloudflare/types'
import { cloudflareErrorMessage, cloudflareHeaders } from '@/tools/cloudflare/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const getTunnelConfigurationTool: ToolConfig<
  CloudflareGetTunnelConfigurationParams,
  CloudflareGetTunnelConfigurationResponse
> = {
  id: 'cloudflare_get_tunnel_configuration',
  name: 'Cloudflare Get Tunnel Configuration',
  description:
    'Reads the configuration of a remotely-managed Cloudflare Tunnel — its ingress rules, origin request settings, and WARP routing. Only tunnels whose configuration source is "cloudflare" have a remote configuration; locally-managed tunnels keep it in their own config file. Requires an API token with Account Cloudflare Tunnel Read.',
  version: '1.0.0',

  params: {
    accountId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The Cloudflare account ID. Tunnels are account-scoped',
    },
    tunnelId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The tunnel ID to read the configuration for',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Cloudflare API Token',
    },
  },

  request: {
    url: (params) =>
      `https://api.cloudflare.com/client/v4/accounts/${safeUrlPathSegment(params.accountId, 'accountId')}/cfd_tunnel/${safeUrlPathSegment(params.tunnelId, 'tunnelId')}/configurations`,
    method: 'GET',
    headers: (params) => cloudflareHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      return {
        success: false,
        output: {
          tunnel_id: '',
          account_id: '',
          version: null,
          source: null,
          created_at: null,
          config: null,
        },
        error: cloudflareErrorMessage(data, 'Failed to get tunnel configuration'),
      }
    }

    const result = data.result
    return {
      success: true,
      output: {
        tunnel_id: result?.tunnel_id ?? '',
        account_id: result?.account_id ?? '',
        version: result?.version ?? null,
        source: result?.source ?? null,
        created_at: result?.created_at ?? null,
        config: result?.config ?? null,
      },
    }
  },

  outputs: {
    tunnel_id: { type: 'string', description: 'Tunnel the configuration belongs to' },
    account_id: { type: 'string', description: 'Account the tunnel belongs to' },
    version: {
      type: 'number',
      description: 'Configuration version, incremented on every change',
      optional: true,
    },
    source: {
      type: 'string',
      description: 'Where the configuration is managed: local or cloudflare',
      optional: true,
    },
    created_at: { type: 'string', description: 'Creation timestamp', optional: true },
    config: {
      type: 'json',
      description:
        'Tunnel configuration with ingress rules, originRequest defaults, and warp-routing settings',
      optional: true,
    },
  },
}
