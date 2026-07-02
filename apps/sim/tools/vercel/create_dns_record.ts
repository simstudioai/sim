import type { ToolConfig } from '@/tools/types'
import type {
  VercelCreateDnsRecordParams,
  VercelCreateDnsRecordResponse,
} from '@/tools/vercel/types'

export const vercelCreateDnsRecordTool: ToolConfig<
  VercelCreateDnsRecordParams,
  VercelCreateDnsRecordResponse
> = {
  id: 'vercel_create_dns_record',
  name: 'Vercel Create DNS Record',
  description: 'Create a DNS record for a domain in a Vercel account',
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
      description: 'The domain name to create the record for',
    },
    recordName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The subdomain or record name',
    },
    recordType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'DNS record type (A, AAAA, ALIAS, CAA, CNAME, HTTPS, MX, SRV, TXT, NS)',
    },
    value: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The value of the DNS record (not used for SRV/HTTPS records)',
    },
    ttl: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Time to live in seconds',
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
      description: 'Target hostname for SRV records (required when recordType is SRV)',
    },
    srvWeight: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Weight for SRV records (required when recordType is SRV)',
    },
    srvPort: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Port for SRV records (required when recordType is SRV)',
    },
    srvPriority: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Priority for SRV records (required when recordType is SRV)',
    },
    httpsTarget: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Target hostname for HTTPS records (required when recordType is HTTPS)',
    },
    httpsPriority: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Priority for HTTPS records (required when recordType is HTTPS)',
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
    url: (params: VercelCreateDnsRecordParams) => {
      const query = new URLSearchParams()
      if (params.teamId) query.set('teamId', params.teamId.trim())
      const qs = query.toString()
      return `https://api.vercel.com/v2/domains/${params.domain.trim()}/records${qs ? `?${qs}` : ''}`
    },
    method: 'POST',
    headers: (params: VercelCreateDnsRecordParams) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params: VercelCreateDnsRecordParams) => {
      const type = params.recordType.trim().toUpperCase()
      const body: Record<string, unknown> = {
        name: params.recordName.trim(),
        type,
      }
      if (params.ttl != null) body.ttl = params.ttl

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
        if (params.value != null) body.value = params.value.trim()
        if (type === 'MX' && params.mxPriority != null) body.mxPriority = params.mxPriority
      }

      if (params.comment != null && params.comment !== '') body.comment = params.comment
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const d = await response.json()

    return {
      success: true,
      output: {
        uid: d.uid ?? null,
        updated: d.updated ?? null,
      },
    }
  },

  outputs: {
    uid: { type: 'string', description: 'The DNS record ID' },
    updated: { type: 'number', description: 'Timestamp of the update' },
  },
}
