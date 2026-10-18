import type {
  CloudflareDeleteR2BucketCorsParams,
  CloudflareDeleteR2BucketCorsResponse,
} from '@/tools/cloudflare/operation-types'
import {
  cloudflareErrorMessage,
  cloudflareHeaders,
  readCloudflareResponse,
} from '@/tools/cloudflare/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const deleteR2BucketCorsTool: ToolConfig<
  CloudflareDeleteR2BucketCorsParams,
  CloudflareDeleteR2BucketCorsResponse
> = {
  id: 'cloudflare_delete_r2_bucket_cors',
  name: 'Cloudflare Delete R2 Bucket Cors',
  description: 'Delete the CORS policy for a bucket.',
  version: '1.0.0',
  params: {
    accountId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Account id',
    },
    bucketName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Bucket name',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Cloudflare API token',
    },
    jurisdiction: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Jurisdiction where objects in this bucket are guaranteed to be stored.',
    },
  },
  request: {
    url: (params) =>
      `https://api.cloudflare.com/client/v4/accounts/${safeUrlPathSegment(params.accountId, 'accountId')}/r2/buckets/${safeUrlPathSegment(params.bucketName, 'bucketName')}/cors`,
    method: 'DELETE',
    headers: (params) => ({
      ...cloudflareHeaders(params.apiKey),
      ...(params.jurisdiction ? { 'cf-r2-jurisdiction': params.jurisdiction } : {}),
    }),
  },
  transformResponse: async (response) => {
    const data = await readCloudflareResponse(response)
    const success = response.ok && data.success === true
    return {
      success,
      output: { success },
      ...(!success
        ? { error: cloudflareErrorMessage(data, 'Failed to delete r2 bucket cors') }
        : {}),
    }
  },
  outputs: {
    success: { type: 'boolean', description: 'Whether Cloudflare accepted the operation' },
  },
}
