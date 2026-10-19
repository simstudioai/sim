import { isRecordLike } from '@sim/utils/object'
import type {
  CloudflareGetDnsRecordParams,
  CloudflareGetDnsRecordResponse,
} from '@/tools/cloudflare/operation-types'
import { DNS_RECORD_OUTPUTS } from '@/tools/cloudflare/outputs'
import {
  appendParam,
  cloudflareErrorMessage,
  cloudflareHeaders,
  mapCloudflareFields,
  readCloudflareResponse,
} from '@/tools/cloudflare/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const getDnsRecordTool: ToolConfig<
  CloudflareGetDnsRecordParams,
  CloudflareGetDnsRecordResponse
> = {
  id: 'cloudflare_get_dns_record',
  name: 'Cloudflare Get Dns Record',
  description: 'Retrieves details for a specific DNS record in the zone.',
  version: '1.0.0',
  params: {
    zoneId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Zone id',
    },
    recordId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Dns record id',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Cloudflare API token',
    },
    include_shadow_metadata: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Whether to include shadow metadata in the `meta` field of each record in the response. See [Shadowed records](https://developers.cloudflare.com/dns/manage-dns-records/reference/shadowed-records).',
    },
  },
  request: {
    url: (params) => {
      const url = new URL(
        `https://api.cloudflare.com/client/v4/zones/${safeUrlPathSegment(params.zoneId, 'zoneId')}/dns_records/${safeUrlPathSegment(params.recordId, 'recordId')}`
      )
      appendParam(url, 'include_shadow_metadata', params.include_shadow_metadata)
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({ ...cloudflareHeaders(params.apiKey) }),
  },
  transformResponse: async (response) => {
    const data = await readCloudflareResponse(response)
    const success = response.ok && data.success === true && isRecordLike(data.result)
    return {
      success,
      output: mapCloudflareFields(data.result, DNS_RECORD_OUTPUTS),
      ...(!success ? { error: cloudflareErrorMessage(data, 'Failed to get dns record') } : {}),
    }
  },
  outputs: DNS_RECORD_OUTPUTS,
}
