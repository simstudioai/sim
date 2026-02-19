import type {
  CloudflareDeleteDnsRecordParams,
  CloudflareDeleteDnsRecordResponse,
} from '@/tools/cloudflare/types'
import type { ToolConfig } from '@/tools/types'

export const deleteDnsRecordTool: ToolConfig<
  CloudflareDeleteDnsRecordParams,
  CloudflareDeleteDnsRecordResponse
> = {
  id: 'cloudflare_delete_dns_record',
  name: 'Cloudflare Delete DNS Record',
  description: 'Deletes a DNS record from a zone.',
  version: '1.0.0',

  params: {
    zoneId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The zone ID containing the DNS record',
    },
    recordId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The DNS record ID to delete',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Cloudflare API Token',
    },
  },

  request: {
    url: (params) =>
      `https://api.cloudflare.com/client/v4/zones/${params.zoneId}/dns_records/${params.recordId}`,
    method: 'DELETE',
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
        output: { id: '' },
        error: data.errors?.[0]?.message ?? 'Failed to delete DNS record',
      }
    }

    return {
      success: true,
      output: {
        id: data.result?.id ?? '',
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Deleted record ID' },
  },
}
