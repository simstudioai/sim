import type {
  CloudflareUpdateR2BucketCorsParams,
  CloudflareUpdateR2BucketCorsResponse,
} from '@/tools/cloudflare/operation-types'
import {
  cloudflareErrorMessage,
  cloudflareHeaders,
  parseJsonArrayParam,
  readCloudflareResponse,
} from '@/tools/cloudflare/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const updateR2BucketCorsTool: ToolConfig<
  CloudflareUpdateR2BucketCorsParams,
  CloudflareUpdateR2BucketCorsResponse
> = {
  id: 'cloudflare_update_r2_bucket_cors',
  name: 'Cloudflare Update R2 Bucket Cors',
  description:
    'Replaces the Cross-Origin Resource Sharing (CORS) rules for an R2 bucket. Rules specify which origins, methods, and headers are allowed for browser requests to objects in the bucket. Replaces the configuration; resend all values to retain.',
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
    rules: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'JSON array. rules Fields: allowed, exposeHeaders, id, maxAgeSeconds.',
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
    method: 'PUT',
    headers: (params) => ({
      ...cloudflareHeaders(params.apiKey),
      ...(params.jurisdiction ? { 'cf-r2-jurisdiction': params.jurisdiction } : {}),
    }),
    body: (params) => ({ rules: parseJsonArrayParam(params.rules, 'rules') }),
  },
  transformResponse: async (response) => {
    const data = await readCloudflareResponse(response)
    const success = response.ok && data.success === true
    return {
      success,
      output: { success },
      ...(!success
        ? { error: cloudflareErrorMessage(data, 'Failed to update r2 bucket cors') }
        : {}),
    }
  },
  outputs: {
    success: { type: 'boolean', description: 'Whether Cloudflare accepted the operation' },
  },
}
