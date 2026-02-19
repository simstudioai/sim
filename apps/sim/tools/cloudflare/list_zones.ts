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
      description: 'Filter by zone status: "initializing", "pending", "active", or "moved"',
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
    accountId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter zones by account ID',
    },
    order: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort field (name, status, account.id, account.name)',
    },
    direction: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort direction (asc, desc)',
    },
    match: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Match logic for filters (any, all). Default: all',
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
      if (params.accountId) url.searchParams.append('account.id', params.accountId)
      if (params.order) url.searchParams.append('order', params.order)
      if (params.direction) url.searchParams.append('direction', params.direction)
      if (params.match) url.searchParams.append('match', params.match)
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
            activated_on: zone.activated_on ?? '',
            development_mode: zone.development_mode ?? 0,
            plan: {
              id: zone.plan?.id ?? '',
              name: zone.plan?.name ?? '',
              price: zone.plan?.price ?? 0,
              is_subscribed: zone.plan?.is_subscribed ?? false,
              frequency: zone.plan?.frequency ?? '',
              currency: zone.plan?.currency ?? '',
              legacy_id: zone.plan?.legacy_id ?? '',
            },
            account: {
              id: zone.account?.id ?? '',
              name: zone.account?.name ?? '',
            },
            owner: {
              id: zone.owner?.id ?? '',
              name: zone.owner?.name ?? '',
              type: zone.owner?.type ?? '',
            },
            meta: {
              cdn_only: zone.meta?.cdn_only ?? false,
              custom_certificate_quota: zone.meta?.custom_certificate_quota ?? 0,
              dns_only: zone.meta?.dns_only ?? false,
              foundation_dns: zone.meta?.foundation_dns ?? false,
              page_rule_quota: zone.meta?.page_rule_quota ?? 0,
              phishing_detected: zone.meta?.phishing_detected ?? false,
              step: zone.meta?.step ?? 0,
            },
            vanity_name_servers: zone.vanity_name_servers ?? [],
            permissions: zone.permissions ?? [],
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
            description: 'Zone status (initializing, pending, active, moved)',
          },
          paused: { type: 'boolean', description: 'Whether the zone is paused' },
          type: { type: 'string', description: 'Zone type (full, partial, or secondary)' },
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
          activated_on: {
            type: 'string',
            description: 'ISO 8601 date when the zone was activated',
            optional: true,
          },
          development_mode: {
            type: 'number',
            description: 'Seconds remaining in development mode (0 = off)',
          },
          plan: {
            type: 'object',
            description: 'Zone plan information',
            properties: {
              id: { type: 'string', description: 'Plan identifier' },
              name: { type: 'string', description: 'Plan name' },
              price: { type: 'number', description: 'Plan price' },
              is_subscribed: {
                type: 'boolean',
                description: 'Whether the zone is subscribed to the plan',
              },
              frequency: { type: 'string', description: 'Plan billing frequency' },
              currency: { type: 'string', description: 'Plan currency' },
              legacy_id: { type: 'string', description: 'Legacy plan identifier' },
            },
          },
          account: {
            type: 'object',
            description: 'Account the zone belongs to',
            properties: {
              id: { type: 'string', description: 'Account identifier' },
              name: { type: 'string', description: 'Account name' },
            },
          },
          owner: {
            type: 'object',
            description: 'Zone owner information',
            properties: {
              id: { type: 'string', description: 'Owner identifier' },
              name: { type: 'string', description: 'Owner name' },
              type: { type: 'string', description: 'Owner type' },
            },
          },
          meta: {
            type: 'object',
            description: 'Zone metadata',
            properties: {
              cdn_only: { type: 'boolean', description: 'Whether the zone is CDN only' },
              custom_certificate_quota: { type: 'number', description: 'Custom certificate quota' },
              dns_only: { type: 'boolean', description: 'Whether the zone is DNS only' },
              foundation_dns: { type: 'boolean', description: 'Whether foundation DNS is enabled' },
              page_rule_quota: { type: 'number', description: 'Page rule quota' },
              phishing_detected: { type: 'boolean', description: 'Whether phishing was detected' },
              step: { type: 'number', description: 'Current setup step' },
            },
            optional: true,
          },
          vanity_name_servers: {
            type: 'array',
            description: 'Custom vanity name servers',
            items: { type: 'string', description: 'Vanity name server hostname' },
            optional: true,
          },
          permissions: {
            type: 'array',
            description: 'User permissions for the zone',
            items: { type: 'string', description: 'Permission string' },
            optional: true,
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
