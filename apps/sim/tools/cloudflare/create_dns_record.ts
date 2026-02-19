import type {
  CloudflareCreateDnsRecordParams,
  CloudflareCreateDnsRecordResponse,
} from '@/tools/cloudflare/types'
import type { ToolConfig } from '@/tools/types'

export const createDnsRecordTool: ToolConfig<
  CloudflareCreateDnsRecordParams,
  CloudflareCreateDnsRecordResponse
> = {
  id: 'cloudflare_create_dns_record',
  name: 'Cloudflare Create DNS Record',
  description: 'Creates a new DNS record for a zone.',
  version: '1.0.0',

  params: {
    zoneId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The zone ID to create the DNS record in',
    },
    type: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'DNS record type (e.g., "A", "AAAA", "CNAME", "MX", "TXT", "NS", "SRV")',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'DNS record name (e.g., "example.com" or "subdomain.example.com")',
    },
    content: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'DNS record content (e.g., IP address for A records, target for CNAME)',
    },
    ttl: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Time to live in seconds (1 = automatic, default: 1)',
    },
    proxied: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to enable Cloudflare proxy (default: false)',
    },
    priority: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Priority for MX and SRV records',
    },
    comment: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comment for the DNS record',
    },
    tags: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated tags for the DNS record',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Cloudflare API Token',
    },
  },

  request: {
    url: (params) => `https://api.cloudflare.com/client/v4/zones/${params.zoneId}/dns_records`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, any> = {
        type: params.type,
        name: params.name,
        content: params.content,
      }
      if (params.ttl !== undefined) body.ttl = Number(params.ttl)
      if (params.proxied !== undefined) body.proxied = params.proxied
      if (params.priority !== undefined) body.priority = Number(params.priority)
      if (params.comment) body.comment = params.comment
      if (params.tags) {
        const tagList = String(params.tags)
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
        if (tagList.length > 0) body.tags = tagList
      }
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      return {
        success: false,
        output: {
          id: '',
          zone_id: '',
          zone_name: '',
          type: '',
          name: '',
          content: '',
          proxiable: false,
          proxied: false,
          ttl: 0,
          locked: false,
          priority: undefined,
          comment: null,
          tags: [],
          comment_modified_on: null,
          tags_modified_on: null,
          meta: null,
          created_on: '',
          modified_on: '',
        },
        error: data.errors?.[0]?.message ?? 'Failed to create DNS record',
      }
    }

    const record = data.result
    return {
      success: true,
      output: {
        id: record?.id ?? '',
        zone_id: record?.zone_id ?? '',
        zone_name: record?.zone_name ?? '',
        type: record?.type ?? '',
        name: record?.name ?? '',
        content: record?.content ?? '',
        proxiable: record?.proxiable ?? false,
        proxied: record?.proxied ?? false,
        ttl: record?.ttl ?? 0,
        locked: record?.locked ?? false,
        priority: record?.priority ?? null,
        comment: record?.comment ?? null,
        tags: record?.tags ?? [],
        comment_modified_on: record?.comment_modified_on ?? null,
        tags_modified_on: record?.tags_modified_on ?? null,
        meta: record?.meta ?? null,
        created_on: record?.created_on ?? '',
        modified_on: record?.modified_on ?? '',
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Unique identifier for the created DNS record' },
    zone_id: { type: 'string', description: 'The ID of the zone the record belongs to' },
    zone_name: { type: 'string', description: 'The name of the zone' },
    type: { type: 'string', description: 'DNS record type (A, AAAA, CNAME, MX, TXT, etc.)' },
    name: { type: 'string', description: 'DNS record hostname' },
    content: {
      type: 'string',
      description: 'DNS record value (e.g., IP address, target hostname)',
    },
    proxiable: {
      type: 'boolean',
      description: 'Whether the record can be proxied through Cloudflare',
    },
    proxied: { type: 'boolean', description: 'Whether Cloudflare proxy is enabled' },
    ttl: { type: 'number', description: 'Time to live in seconds (1 = automatic)' },
    locked: { type: 'boolean', description: 'Whether the record is locked' },
    priority: { type: 'number', description: 'Priority for MX and SRV records', optional: true },
    comment: { type: 'string', description: 'Comment associated with the record', optional: true },
    tags: {
      type: 'array',
      description: 'Tags associated with the record',
      items: { type: 'string', description: 'Tag value' },
    },
    comment_modified_on: {
      type: 'string',
      description: 'ISO 8601 timestamp when the comment was last modified',
      optional: true,
    },
    tags_modified_on: {
      type: 'string',
      description: 'ISO 8601 timestamp when tags were last modified',
      optional: true,
    },
    meta: {
      type: 'object',
      description: 'Record metadata',
      optional: true,
      properties: {
        source: { type: 'string', description: 'Source of the DNS record' },
      },
    },
    created_on: { type: 'string', description: 'ISO 8601 timestamp when the record was created' },
    modified_on: {
      type: 'string',
      description: 'ISO 8601 timestamp when the record was last modified',
    },
  },
}
