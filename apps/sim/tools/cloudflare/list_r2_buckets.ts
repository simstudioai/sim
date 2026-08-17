import type {
  CloudflareListR2BucketsParams,
  CloudflareListR2BucketsResponse,
  CloudflareRawR2Bucket,
} from '@/tools/cloudflare/types'
import {
  appendParam,
  cloudflareErrorMessage,
  cloudflareHeaders,
  readCloudflareResponse,
} from '@/tools/cloudflare/utils'
import type { ToolConfig } from '@/tools/types'

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
        `https://api.cloudflare.com/client/v4/accounts/${params.accountId.trim()}/r2/buckets`
      )
      appendParam(url, 'name_contains', params.name_contains)
      appendParam(url, 'start_after', params.start_after)
      appendParam(url, 'cursor', params.cursor)
      appendParam(url, 'direction', params.direction)
      appendParam(url, 'per_page', params.per_page)
      // `direction` only means something alongside an ordering field, and `name`
      // is the sole value Cloudflare documents for `order`.
      if (params.direction) url.searchParams.append('order', 'name')
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
    const data = await readCloudflareResponse<{ buckets?: CloudflareRawR2Bucket[] }>(response)

    if (!data.success) {
      return {
        success: false,
        output: { buckets: [], cursor: null },
        error: cloudflareErrorMessage(data, 'Failed to list R2 buckets'),
      }
    }

    const buckets = Array.isArray(data.result?.buckets) ? data.result.buckets : []

    return {
      success: true,
      output: {
        buckets: buckets.map((bucket) => ({
          name: bucket.name ?? '',
          creation_date: bucket.creation_date ?? null,
          location: bucket.location ?? null,
          storage_class: bucket.storage_class ?? null,
          jurisdiction: bucket.jurisdiction ?? null,
        })),
        cursor: data.result_info?.cursor ?? null,
      },
    }
  },

  outputs: {
    buckets: {
      type: 'array',
      description: 'R2 buckets in the account',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Bucket name' },
          creation_date: { type: 'string', description: 'Creation timestamp', optional: true },
          location: {
            type: 'string',
            description:
              'Location hint the bucket was created with (apac, eeur, enam, weur, wnam, or oc)',
            optional: true,
          },
          storage_class: {
            type: 'string',
            description: 'Default storage class (Standard or InfrequentAccess)',
            optional: true,
          },
          jurisdiction: {
            type: 'string',
            description: 'Data-residency jurisdiction (default, eu, or fedramp)',
            optional: true,
          },
        },
      },
    },
    cursor: {
      type: 'string',
      description: 'Pagination cursor to pass to the next call',
      optional: true,
    },
  },
}
