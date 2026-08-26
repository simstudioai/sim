import type {
  CloudflareDeleteDnsRecordParams,
  CloudflareDeleteDnsRecordResponse,
} from '@/tools/cloudflare/types'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

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
      `https://api.cloudflare.com/client/v4/zones/${safeUrlPathSegment(params.zoneId, 'zoneId')}/dns_records/${safeUrlPathSegment(params.recordId, 'recordId')}`,
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    /**
     * This endpoint is the one Cloudflare v4 response that does NOT carry the
     * shared envelope: its documented body is `{ "result": { "id": ... } }` with
     * no `success`, `errors`, or `messages`. Branching on `!data.success` would
     * therefore report every successful delete as a failure, so the check must
     * be an explicit `=== false` — which still fails a real `success: false`
     * body if Cloudflare ever starts sending the full envelope here.
     * https://developers.cloudflare.com/api/resources/dns/subresources/records/methods/delete/
     */
    if (data.success === false) {
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
