import type {
  CloudflareListZonesParams,
  CloudflareListZonesResponse,
} from '@/tools/cloudflare/types'
import type { ToolConfig } from '@/tools/types'

export const listZonesTool: ToolConfig<CloudflareListZonesParams, CloudflareListZonesResponse> = {
  id: 'cloudflare_list_zones',
  name: 'Cloudflare List Zones',
  description: 'Lists all zones (domains) in the Cloudflare account.',
  version: '1.0.0',

  params: {
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter zones by domain name (e.g., "example.com")',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by zone status (e.g., "active", "pending", "initializing")',
    },
    page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page number for pagination (default: 1)',
    },
    per_page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of zones per page (default: 20, max: 50)',
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
      const url = new URL('https://api.cloudflare.com/client/v4/zones')
      if (params.name) url.searchParams.append('name', params.name)
      if (params.status) url.searchParams.append('status', params.status)
      if (params.page) url.searchParams.append('page', String(params.page))
      if (params.per_page) url.searchParams.append('per_page', String(params.per_page))
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      return {
        success: false,
        output: { zones: [], total_count: 0 },
        error: data.errors?.[0]?.message ?? 'Failed to list zones',
      }
    }

    return {
      success: true,
      output: {
        zones:
          data.result?.map((zone: any) => ({
            id: zone.id ?? '',
            name: zone.name ?? '',
            status: zone.status ?? '',
            paused: zone.paused ?? false,
            type: zone.type ?? '',
            name_servers: zone.name_servers ?? [],
            original_name_servers: zone.original_name_servers ?? [],
            created_on: zone.created_on ?? '',
            modified_on: zone.modified_on ?? '',
            plan: {
              id: zone.plan?.id ?? '',
              name: zone.plan?.name ?? '',
            },
          })) ?? [],
        total_count: data.result_info?.total_count ?? data.result?.length ?? 0,
      },
    }
  },

  outputs: {
    zones: {
      type: 'array',
      description: 'List of zones/domains',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Zone ID' },
          name: { type: 'string', description: 'Domain name' },
          status: {
            type: 'string',
            description: 'Zone status (active, pending, initializing, moved, deleted, deactivated)',
          },
          paused: { type: 'boolean', description: 'Whether the zone is paused' },
          type: { type: 'string', description: 'Zone type (full or partial)' },
          name_servers: {
            type: 'array',
            description: 'Assigned Cloudflare name servers',
            items: { type: 'string', description: 'Name server hostname' },
          },
          original_name_servers: {
            type: 'array',
            description: 'Original name servers before moving to Cloudflare',
            items: { type: 'string', description: 'Name server hostname' },
            optional: true,
          },
          created_on: { type: 'string', description: 'ISO 8601 date when the zone was created' },
          modified_on: {
            type: 'string',
            description: 'ISO 8601 date when the zone was last modified',
          },
          plan: {
            type: 'object',
            description: 'Zone plan information',
            properties: {
              id: { type: 'string', description: 'Plan identifier' },
              name: { type: 'string', description: 'Plan name' },
            },
          },
        },
      },
    },
    total_count: {
      type: 'number',
      description: 'Total number of zones matching the query',
    },
  },
}
