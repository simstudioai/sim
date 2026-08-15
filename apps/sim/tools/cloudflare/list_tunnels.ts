import type {
  CloudflareListTunnelsParams,
  CloudflareListTunnelsResponse,
  CloudflareRawTunnel,
} from '@/tools/cloudflare/types'
import {
  appendParam,
  cloudflareErrorMessage,
  cloudflareHeaders,
  readCloudflareResponse,
} from '@/tools/cloudflare/utils'
import type { ToolConfig } from '@/tools/types'

export const listTunnelsTool: ToolConfig<
  CloudflareListTunnelsParams,
  CloudflareListTunnelsResponse
> = {
  id: 'cloudflare_list_tunnels',
  name: 'Cloudflare List Tunnels',
  description:
    'Lists the Cloudflare Tunnels (cloudflared) in an account, with their health status and active connections. Requires an API token with Account Cloudflare Tunnel Read.',
  version: '1.0.0',

  params: {
    accountId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The Cloudflare account ID. Tunnels are account-scoped',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by exact tunnel name',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by tunnel health: inactive, degraded, healthy, or down',
    },
    uuid: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by tunnel UUID',
    },
    is_deleted: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to return deleted tunnels instead of active ones',
    },
    include_prefix: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only include tunnels whose name starts with this prefix',
    },
    exclude_prefix: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Exclude tunnels whose name starts with this prefix',
    },
    existed_at: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return tunnels that existed at this RFC 3339 timestamp',
    },
    was_active_at: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return tunnels that were active at this RFC 3339 timestamp',
    },
    was_inactive_at: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return tunnels that were inactive at this RFC 3339 timestamp',
    },
    page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page number for pagination',
    },
    per_page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of tunnels per page',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Cloudflare API Token',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(
        `https://api.cloudflare.com/client/v4/accounts/${params.accountId.trim()}/cfd_tunnel`
      )
      appendParam(url, 'name', params.name)
      appendParam(url, 'status', params.status)
      appendParam(url, 'uuid', params.uuid)
      if (params.is_deleted !== undefined) {
        url.searchParams.append('is_deleted', String(params.is_deleted))
      }
      appendParam(url, 'include_prefix', params.include_prefix)
      appendParam(url, 'exclude_prefix', params.exclude_prefix)
      appendParam(url, 'existed_at', params.existed_at)
      appendParam(url, 'was_active_at', params.was_active_at)
      appendParam(url, 'was_inactive_at', params.was_inactive_at)
      appendParam(url, 'page', params.page)
      appendParam(url, 'per_page', params.per_page)
      return url.toString()
    },
    method: 'GET',
    headers: (params) => cloudflareHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await readCloudflareResponse<CloudflareRawTunnel[]>(response)

    if (!data.success) {
      return {
        success: false,
        output: { tunnels: [], total_count: 0 },
        error: cloudflareErrorMessage(data, 'Failed to list tunnels'),
      }
    }

    const tunnels = Array.isArray(data.result) ? data.result : []

    return {
      success: true,
      output: {
        tunnels: tunnels.map((tunnel) => ({
          id: tunnel.id ?? '',
          name: tunnel.name ?? null,
          account_tag: tunnel.account_tag ?? null,
          config_src: tunnel.config_src ?? null,
          status: tunnel.status ?? null,
          tun_type: tunnel.tun_type ?? null,
          remote_config: tunnel.remote_config ?? null,
          metadata: tunnel.metadata ?? null,
          created_at: tunnel.created_at ?? null,
          deleted_at: tunnel.deleted_at ?? null,
          conns_active_at: tunnel.conns_active_at ?? null,
          conns_inactive_at: tunnel.conns_inactive_at ?? null,
          connections: tunnel.connections ?? null,
        })),
        total_count: data.result_info?.total_count ?? tunnels.length,
      },
    }
  },

  outputs: {
    tunnels: {
      type: 'array',
      description: 'Cloudflare Tunnels in the account',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Tunnel identifier' },
          name: { type: 'string', description: 'Tunnel name', optional: true },
          account_tag: {
            type: 'string',
            description: 'Account the tunnel belongs to',
            optional: true,
          },
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
      },
    },
    total_count: { type: 'number', description: 'Total number of tunnels' },
  },
}
