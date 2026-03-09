import type { ToolConfig } from '@/tools/types'
import type { VercelListDnsRecordsParams, VercelListDnsRecordsResponse } from '@/tools/vercel/types'

export const vercelListDnsRecordsTool: ToolConfig<
  VercelListDnsRecordsParams,
  VercelListDnsRecordsResponse
> = {
  id: 'vercel_list_dns_records',
  name: 'Vercel List DNS Records',
  description: 'List all DNS records for a domain in a Vercel account',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Vercel Access Token',
    },
    domain: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The domain name to list records for',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of records to return',
    },
    teamId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Team ID to scope the request',
    },
  },

  request: {
    url: (params: VercelListDnsRecordsParams) => {
      const query = new URLSearchParams()
      if (params.limit) query.set('limit', String(params.limit))
      if (params.teamId) query.set('teamId', params.teamId.trim())
      const qs = query.toString()
      return `https://api.vercel.com/v4/domains/${params.domain.trim()}/records${qs ? `?${qs}` : ''}`
    },
    method: 'GET',
    headers: (params: VercelListDnsRecordsParams) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    const records = (data.records ?? []).map((r: any) => ({
      id: r.id ?? null,
      slug: r.slug ?? null,
      name: r.name ?? null,
      type: r.type ?? null,
      value: r.value ?? null,
      ttl: r.ttl ?? null,
      mxPriority: r.mxPriority ?? null,
      priority: r.priority ?? null,
      creator: r.creator ?? null,
      createdAt: r.createdAt ?? null,
      updatedAt: r.updatedAt ?? null,
      comment: r.comment ?? null,
    }))

    return {
      success: true,
      output: {
        records,
        count: records.length,
        hasMore: data.pagination?.next != null,
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
          id: { type: 'string', description: 'Record ID' },
          slug: { type: 'string', description: 'Record slug' },
          name: { type: 'string', description: 'Record name' },
          type: {
            type: 'string',
            description: 'Record type (A, AAAA, ALIAS, CAA, CNAME, HTTPS, MX, SRV, TXT, NS)',
          },
          value: { type: 'string', description: 'Record value' },
          ttl: { type: 'number', description: 'Time to live in seconds' },
          mxPriority: { type: 'number', description: 'MX record priority' },
          priority: { type: 'number', description: 'Record priority' },
          creator: { type: 'string', description: 'Creator identifier' },
          createdAt: { type: 'number', description: 'Creation timestamp' },
          updatedAt: { type: 'number', description: 'Last update timestamp' },
          comment: { type: 'string', description: 'Record comment' },
        },
      },
    },
    count: {
      type: 'number',
      description: 'Number of records returned',
    },
    hasMore: {
      type: 'boolean',
      description: 'Whether more records are available',
    },
  },
}
