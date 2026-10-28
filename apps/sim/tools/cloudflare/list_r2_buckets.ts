import { toRecord } from '@sim/utils/object'
import { R2_BUCKET_OUTPUTS, RESULT_INFO_OUTPUTS } from '@/tools/cloudflare/outputs'
import type {
  CloudflareListR2BucketsParams,
  CloudflareListR2BucketsResponse,
} from '@/tools/cloudflare/types'
import {
  appendParam,
  cloudflareErrorMessage,
  cloudflareHeaders,
  mapCloudflareFields,
  readCloudflareResponse,
} from '@/tools/cloudflare/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const listR2BucketsTool: ToolConfig<
  CloudflareListR2BucketsParams,
  CloudflareListR2BucketsResponse
> = {
  id: 'cloudflare_list_r2_buckets',
  name: 'Cloudflare List R2 Buckets',
  description:
    'Lists the R2 object storage buckets in an account. Requires an API token with Account Workers R2 Storage Read.',
  version: '1.0.0',

  params: {
    order: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Order buckets by name. Allowed values: name.',
    },
    accountId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The Cloudflare account ID. R2 buckets are account-scoped',
    },
    name_contains: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return buckets whose name contains this substring',
    },
    start_after: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Bucket name to start listing after',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor returned by a previous call',
    },
    direction: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort direction by bucket name: asc or desc',
    },
    per_page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of buckets per page',
    },
    jurisdiction: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Data-residency jurisdiction to list within: default, eu, or fedramp',
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
        `https://api.cloudflare.com/client/v4/accounts/${safeUrlPathSegment(params.accountId, 'accountId')}/r2/buckets`
      )
      appendParam(url, 'name_contains', params.name_contains)
      appendParam(url, 'start_after', params.start_after)
      appendParam(url, 'cursor', params.cursor)
      appendParam(url, 'direction', params.direction)
      appendParam(url, 'per_page', params.per_page)
      // `direction` only means something alongside an ordering field, and `name`
      // is the sole value Cloudflare documents for `order`.
      appendParam(url, 'order', params.order || (params.direction ? 'name' : undefined))
      return url.toString()
    },
    method: 'GET',
    headers: (params) => {
      const headers = cloudflareHeaders(params.apiKey)
      if (params.jurisdiction) headers['cf-r2-jurisdiction'] = params.jurisdiction
      return headers
    },
  },

  transformResponse: async (response: Response) => {
    const data = await readCloudflareResponse(response)
    const raw = toRecord(data.result).buckets
    const rows = Array.isArray(raw) ? raw : []
    const success = response.ok && data.success === true && Array.isArray(raw)
    return {
      success,
      output: {
        buckets: rows.map((row) => mapCloudflareFields(row, R2_BUCKET_OUTPUTS)),
        total_count: data.result_info?.total_count ?? rows.length,
        result_info: data.result_info ?? null,
        cursor: data.result_info?.cursor ?? null,
      },
      ...(!success ? { error: cloudflareErrorMessage(data, 'Failed to list r2 buckets') } : {}),
    }
  },
  outputs: {
    buckets: {
      type: 'array',
      description: 'Buckets',
      items: { type: 'object', properties: R2_BUCKET_OUTPUTS },
    },
    total_count: {
      type: 'number',
      description:
        'Total active buckets in the requested jurisdiction, independent of filtering or pagination. Eventually consistent for accounts with elevated bucket limits. Falls back to this page’s bucket count when the API omits the total.',
    },
    result_info: {
      type: 'json',
      description: 'Pagination metadata returned by Cloudflare',
      nullable: true,
      properties: {
        ...RESULT_INFO_OUTPUTS,
        total_count: {
          ...RESULT_INFO_OUTPUTS.total_count,
          description:
            'Total active buckets in the requested jurisdiction, independent of filtering or pagination. Eventually consistent for accounts with elevated bucket limits.',
        },
      },
    },
    cursor: { type: 'string', description: 'Cursor for the next page', nullable: true },
  },
}
