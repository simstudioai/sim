import type { CloudflareGetTunnelParams, CloudflareTunnelResponse } from '@/tools/cloudflare/types'
import { cloudflareErrorMessage, cloudflareHeaders } from '@/tools/cloudflare/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const getTunnelTool: ToolConfig<CloudflareGetTunnelParams, CloudflareTunnelResponse> = {
  id: 'cloudflare_get_tunnel',
  name: 'Cloudflare Get Tunnel',
  description:
    'Reads a single Cloudflare Tunnel (cloudflared), including its health status and active connector connections. Requires an API token with Account Cloudflare Tunnel Read.',
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
      description: 'The tunnel ID to read',
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
      `https://api.cloudflare.com/client/v4/accounts/${safeUrlPathSegment(params.accountId, 'accountId')}/cfd_tunnel/${safeUrlPathSegment(params.tunnelId, 'tunnelId')}`,
    method: 'GET',
    headers: (params) => cloudflareHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      return {
        success: false,
        output: {
          id: '',
          name: null,
          account_tag: null,
          config_src: null,
          status: null,
          tun_type: null,
          remote_config: null,
          metadata: null,
          created_at: null,
          deleted_at: null,
          conns_active_at: null,
          conns_inactive_at: null,
          connections: null,
        },
        error: cloudflareErrorMessage(data, 'Failed to get tunnel'),
      }
    }

    const tunnel = data.result
    return {
      success: true,
      output: {
        id: tunnel?.id ?? '',
        name: tunnel?.name ?? null,
        account_tag: tunnel?.account_tag ?? null,
        config_src: tunnel?.config_src ?? null,
        status: tunnel?.status ?? null,
        tun_type: tunnel?.tun_type ?? null,
        remote_config: tunnel?.remote_config ?? null,
        metadata: tunnel?.metadata ?? null,
        created_at: tunnel?.created_at ?? null,
        deleted_at: tunnel?.deleted_at ?? null,
        conns_active_at: tunnel?.conns_active_at ?? null,
        conns_inactive_at: tunnel?.conns_inactive_at ?? null,
        connections: tunnel?.connections ?? null,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Tunnel identifier' },
    name: { type: 'string', description: 'Tunnel name', optional: true },
    account_tag: { type: 'string', description: 'Account the tunnel belongs to', optional: true },
    config_src: {
      type: 'string',
      description: 'Where the tunnel configuration lives: local or cloudflare',
      optional: true,
    },
    status: {
      type: 'string',
      description: 'Tunnel health: inactive, degraded, healthy, or down',
      optional: true,
    },
    tun_type: {
      type: 'string',
      description: 'Tunnel type, e.g. cfd_tunnel, warp_connector, or warp',
      optional: true,
    },
    remote_config: {
      type: 'boolean',
      description: 'Whether the tunnel is remotely managed',
      optional: true,
    },
    metadata: {
      type: 'json',
      description: 'Metadata associated with the tunnel',
      optional: true,
    },
    created_at: { type: 'string', description: 'Creation timestamp', optional: true },
    deleted_at: { type: 'string', description: 'Deletion timestamp', optional: true },
    conns_active_at: {
      type: 'string',
      description: 'When the tunnel last had active connections',
      optional: true,
    },
    conns_inactive_at: {
      type: 'string',
      description: 'When the tunnel last lost all connections',
      optional: true,
    },
    connections: {
      type: 'json',
      description: 'Active connector connections for the tunnel',
      optional: true,
    },
  },
}
