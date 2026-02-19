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
      required: true,
      visibility: 'user-or-llm',
      description: 'The value of the DNS record',
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
      const body: Record<string, unknown> = {
        name: params.recordName.trim(),
        type: params.recordType.trim(),
        value: params.value.trim(),
      }
      if (params.ttl != null) body.ttl = params.ttl
      if (params.mxPriority != null) body.mxPriority = params.mxPriority
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
