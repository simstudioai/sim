import { CERTIFICATE_OUTPUTS, RESULT_INFO_OUTPUTS } from '@/tools/cloudflare/outputs'
import type {
  CloudflareListCertificatesParams,
  CloudflareListCertificatesResponse,
} from '@/tools/cloudflare/types'
import {
  cloudflareErrorMessage,
  mapCloudflareFields,
  readCloudflareResponse,
} from '@/tools/cloudflare/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const listCertificatesTool: ToolConfig<
  CloudflareListCertificatesParams,
  CloudflareListCertificatesResponse
> = {
  id: 'cloudflare_list_certificates',
  name: 'Cloudflare List Certificates',
  description: 'Lists SSL/TLS certificate packs for a zone.',
  version: '1.0.0',

  params: {
    zoneId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The zone ID to list certificates for',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Set to "all" to include every certificate pack regardless of status. Cloudflare documents no other value for this filter; omitting it returns only active packs',
    },
    page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page number of paginated results (default: 1)',
    },
    per_page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of certificate packs per page (default: 20, min: 5, max: 50)',
    },
    deploy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by deployment environment: "staging" or "production"',
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
      const url = new URL(
        `https://api.cloudflare.com/client/v4/zones/${safeUrlPathSegment(params.zoneId, 'zoneId')}/ssl/certificate_packs`
      )
      if (params.status) url.searchParams.append('status', params.status)
      if (params.page) url.searchParams.append('page', String(params.page))
      if (params.per_page) url.searchParams.append('per_page', String(params.per_page))
      if (params.deploy) url.searchParams.append('deploy', params.deploy)
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await readCloudflareResponse(response)
    const raw = data.result
    const rows = Array.isArray(raw) ? raw : []
    const success = response.ok && data.success === true && Array.isArray(raw)
    return {
      success,
      output: {
        certificates: rows.map((row) => mapCloudflareFields(row, CERTIFICATE_OUTPUTS)),
        total_count: data.result_info?.total_count ?? rows.length,
        result_info: data.result_info ?? null,
      },
      ...(!success ? { error: cloudflareErrorMessage(data, 'Failed to list certificates') } : {}),
    }
  },
  outputs: {
    certificates: {
      type: 'array',
      description: 'Certificates',
      items: { type: 'object', properties: CERTIFICATE_OUTPUTS },
    },
    total_count: {
      type: 'number',
      description:
        'Total matching resources, or the number of resources returned on this page when the API omits a total',
    },
    result_info: {
      type: 'json',
      description: 'Pagination metadata returned by Cloudflare',
      nullable: true,
      properties: RESULT_INFO_OUTPUTS,
    },
  },
}
