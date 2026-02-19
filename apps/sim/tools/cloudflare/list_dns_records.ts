import type {
  CloudflareListDnsRecordsParams,
  CloudflareListDnsRecordsResponse,
} from '@/tools/cloudflare/types'
import type { ToolConfig } from '@/tools/types'

export const listDnsRecordsTool: ToolConfig<
  CloudflareListDnsRecordsParams,
  CloudflareListDnsRecordsResponse
> = {
  id: 'cloudflare_list_dns_records',
  name: 'Cloudflare List DNS Records',
  description: 'Lists DNS records for a specific zone.',
  version: '1.0.0',

  params: {
    zoneId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The zone ID to list DNS records for',
    },
    type: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by record type (e.g., "A", "AAAA", "CNAME", "MX", "TXT")',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by record name (substring match)',
    },
    content: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by record content (substring match)',
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
      description: 'Number of records per page (default: 100, max: 5000000)',
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
      const url = new URL(`https://api.cloudflare.com/client/v4/zones/${params.zoneId}/dns_records`)
      if (params.type) url.searchParams.append('type', params.type)
      if (params.name) url.searchParams.append('name', params.name)
      if (params.content) url.searchParams.append('content', params.content)
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
        output: { records: [], total_count: 0 },
        error: data.errors?.[0]?.message ?? 'Failed to list DNS records',
      }
    }

    return {
      success: true,
      output: {
        records:
          data.result?.map((record: any) => ({
            id: record.id ?? '',
            zone_id: record.zone_id ?? '',
            zone_name: record.zone_name ?? '',
            type: record.type ?? '',
            name: record.name ?? '',
            content: record.content ?? '',
            proxiable: record.proxiable ?? false,
            proxied: record.proxied ?? false,
            ttl: record.ttl ?? 0,
            locked: record.locked ?? false,
            priority: record.priority ?? null,
            comment: record.comment ?? null,
            tags: record.tags ?? [],
            created_on: record.created_on ?? '',
            modified_on: record.modified_on ?? '',
          })) ?? [],
        total_count: data.result_info?.total_count ?? data.result?.length ?? 0,
      },
    }
  },

  outputs: {
    records: {
      type: 'array',
      description: 'List of DNS records',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Unique identifier for the DNS record' },
          zone_id: { type: 'string', description: 'The ID of the zone the record belongs to' },
          zone_name: { type: 'string', description: 'The name of the zone' },
          type: { type: 'string', description: 'Record type (A, AAAA, CNAME, MX, TXT, etc.)' },
          name: { type: 'string', description: 'Record name (e.g., example.com)' },
          content: { type: 'string', description: 'Record content (e.g., IP address)' },
          proxiable: { type: 'boolean', description: 'Whether the record can be proxied' },
          proxied: { type: 'boolean', description: 'Whether Cloudflare proxy is enabled' },
          ttl: { type: 'number', description: 'TTL in seconds (1 = automatic)' },
          locked: { type: 'boolean', description: 'Whether the record is locked' },
          priority: { type: 'number', description: 'MX/SRV record priority', optional: true },
          comment: {
            type: 'string',
            description: 'Comment associated with the record',
            optional: true,
          },
          tags: {
            type: 'array',
            description: 'Tags associated with the record',
            items: { type: 'string', description: 'Tag value' },
          },
          created_on: {
            type: 'string',
            description: 'ISO 8601 timestamp when the record was created',
          },
          modified_on: {
            type: 'string',
            description: 'ISO 8601 timestamp when the record was last modified',
          },
        },
      },
    },
    total_count: {
      type: 'number',
      description: 'Total number of DNS records matching the query',
    },
  },
}
