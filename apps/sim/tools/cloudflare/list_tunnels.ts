import { RESULT_INFO_OUTPUTS, TUNNEL_OUTPUTS } from '@/tools/cloudflare/outputs'
import type {
  CloudflareListTunnelsParams,
  CloudflareListTunnelsResponse,
} from '@/tools/cloudflare/types'
import {
  appendParam,
  cloudflareErrorMessage,
  cloudflareHeaders,
  mapCloudflareFields,
  readCloudflareResponse,
} from '@/tools/cloudflare/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

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
        `https://api.cloudflare.com/client/v4/accounts/${safeUrlPathSegment(params.accountId, 'accountId')}/cfd_tunnel`
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
    const data = await readCloudflareResponse(response)
    const raw = data.result
    const rows = Array.isArray(raw) ? raw : []
    const success = response.ok && data.success === true && Array.isArray(raw)
    return {
      success,
      output: {
        tunnels: rows.map((row) => mapCloudflareFields(row, TUNNEL_OUTPUTS)),
        total_count: data.result_info?.total_count ?? rows.length,
        result_info: data.result_info ?? null,
      },
      ...(!success ? { error: cloudflareErrorMessage(data, 'Failed to list tunnels') } : {}),
    }
  },
  outputs: {
    tunnels: {
      type: 'array',
      description: 'Tunnels',
      items: { type: 'object', properties: TUNNEL_OUTPUTS },
    },
    total_count: {
      type: 'number',
      description:
        'Total matching resources, or the number of resources returned on this page when the API omits a total',
    },
    result_info: {
      type: 'json',
      description: 'Pagination metadata returned by Cloudflare',
      nullable: true,
      properties: RESULT_INFO_OUTPUTS,
    },
  },
}
