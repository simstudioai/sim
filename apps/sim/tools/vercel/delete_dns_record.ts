import type { ToolConfig } from '@/tools/types'
import type {
  VercelDeleteDnsRecordParams,
  VercelDeleteDnsRecordResponse,
} from '@/tools/vercel/types'

export const vercelDeleteDnsRecordTool: ToolConfig<
  VercelDeleteDnsRecordParams,
  VercelDeleteDnsRecordResponse
> = {
  id: 'vercel_delete_dns_record',
  name: 'Vercel Delete DNS Record',
  description: 'Delete a DNS record for a domain in a Vercel account',
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
      description: 'The domain name the record belongs to',
    },
    recordId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the DNS record to delete',
    },
    teamId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Team ID to scope the request',
    },
  },

  request: {
    url: (params: VercelDeleteDnsRecordParams) => {
      const query = new URLSearchParams()
      if (params.teamId) query.set('teamId', params.teamId.trim())
      const qs = query.toString()
      return `https://api.vercel.com/v2/domains/${params.domain.trim()}/records/${params.recordId.trim()}${qs ? `?${qs}` : ''}`
    },
    method: 'DELETE',
    headers: (params: VercelDeleteDnsRecordParams) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async () => {
    return {
      success: true,
      output: {
        deleted: true,
      },
    }
  },

  outputs: {
    deleted: { type: 'boolean', description: 'Whether the record was deleted' },
  },
}
