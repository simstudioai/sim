import type { ToolConfig } from '@/tools/types'
import type {
  VercelUpdateDnsRecordParams,
  VercelUpdateDnsRecordResponse,
} from '@/tools/vercel/types'

export const vercelUpdateDnsRecordTool: ToolConfig<
  VercelUpdateDnsRecordParams,
  VercelUpdateDnsRecordResponse
> = {
  id: 'vercel_update_dns_record',
  name: 'Vercel Update DNS Record',
  description: 'Update an existing DNS record for a domain in a Vercel account',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Vercel Access Token',
    },
    recordId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the DNS record to update',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The name of the DNS record',
    },
    value: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The value of the DNS record',
    },
    type: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'DNS record type (A, AAAA, ALIAS, CAA, CNAME, HTTPS, MX, SRV, TXT, NS)',
    },
    ttl: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Time to live in seconds (60 to 2147483647)',
    },
    mxPriority: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Priority for MX records',
    },
    srvTarget: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Target hostname for SRV records (required together when updating SRV data)',
    },
    srvWeight: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Weight for SRV records (required together when updating SRV data)',
    },
    srvPort: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Port for SRV records (required together when updating SRV data)',
    },
    srvPriority: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Priority for SRV records (required together when updating SRV data)',
    },
    httpsTarget: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Target hostname for HTTPS records (required together when updating HTTPS data)',
    },
    httpsPriority: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Priority for HTTPS records (required together when updating HTTPS data)',
    },
    httpsParams: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional service parameters for HTTPS records (e.g. "alpn=h2,h3")',
    },
    comment: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'A comment to add context on what this DNS record is for (max 500 characters)',
    },
    teamId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Team ID to scope the request',
    },
  },

  request: {
    url: (params: VercelUpdateDnsRecordParams) => {
      const query = new URLSearchParams()
      if (params.teamId) query.set('teamId', params.teamId.trim())
      const qs = query.toString()
      return `https://api.vercel.com/v1/domains/records/${params.recordId.trim()}${qs ? `?${qs}` : ''}`
    },
    method: 'PATCH',
    headers: (params: VercelUpdateDnsRecordParams) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params: VercelUpdateDnsRecordParams) => {
      const body: Record<string, unknown> = {}
      if (params.name != null && params.name !== '') body.name = params.name
      const type =
        params.type != null && params.type !== '' ? params.type.trim().toUpperCase() : null
      if (type != null) body.type = type
      if (params.ttl != null) {
        const ttl = Number(params.ttl)
        if (!Number.isNaN(ttl)) body.ttl = ttl
      }

      if (type === 'SRV') {
        body.srv = {
          target: params.srvTarget?.trim(),
          weight: params.srvWeight,
          port: params.srvPort,
          priority: params.srvPriority,
        }
      } else if (type === 'HTTPS') {
        body.https = {
          target: params.httpsTarget?.trim(),
          priority: params.httpsPriority,
          ...(params.httpsParams ? { params: params.httpsParams.trim() } : {}),
        }
      } else {
        if (params.value != null && params.value !== '') body.value = params.value
        if (params.mxPriority != null) {
          const mxPriority = Number(params.mxPriority)
          if (!Number.isNaN(mxPriority)) body.mxPriority = mxPriority
        }
      }

      if (params.comment != null && params.comment !== '') body.comment = params.comment
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json().catch(() => ({}))

    return {
      success: true,
      output: {
        id: data.id ?? null,
        name: data.name ?? null,
        type: data.type ?? null,
        value: data.value ?? null,
        creator: data.creator ?? null,
        domain: data.domain ?? null,
        ttl: data.ttl ?? null,
        comment: data.comment ?? null,
        recordType: data.recordType ?? null,
        createdAt: data.createdAt ?? null,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'The DNS record ID', optional: true },
    name: { type: 'string', description: 'The name of the DNS record', optional: true },
    type: {
      type: 'string',
      description: 'The record class (record or record-sys)',
      optional: true,
    },
    value: { type: 'string', description: 'The value of the DNS record', optional: true },
    creator: { type: 'string', description: 'The creator of the DNS record', optional: true },
    domain: { type: 'string', description: 'The domain the record belongs to', optional: true },
    ttl: { type: 'number', description: 'Time to live in seconds', optional: true },
    comment: {
      type: 'string',
      description: 'Comment providing context for the record',
      optional: true,
    },
    recordType: {
      type: 'string',
      description: 'DNS record type (A, AAAA, ALIAS, CAA, CNAME, HTTPS, MX, NS, SRV, TXT)',
      optional: true,
    },
    createdAt: { type: 'number', description: 'Timestamp of record creation', optional: true },
  },
}
