import { isRecordLike } from '@sim/utils/object'
import type {
  CloudflareGetR2BucketCorsParams,
  CloudflareGetR2BucketCorsResponse,
} from '@/tools/cloudflare/operation-types'
import { R2_CORS_OUTPUTS } from '@/tools/cloudflare/outputs'
import {
  cloudflareErrorMessage,
  cloudflareHeaders,
  mapCloudflareFields,
  readCloudflareResponse,
} from '@/tools/cloudflare/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const getR2BucketCorsTool: ToolConfig<
  CloudflareGetR2BucketCorsParams,
  CloudflareGetR2BucketCorsResponse
> = {
  id: 'cloudflare_get_r2_bucket_cors',
  name: 'Cloudflare Get R2 Bucket Cors',
  description: 'Get the CORS policy for a bucket.',
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
    method: 'GET',
    headers: (params) => ({
      ...cloudflareHeaders(params.apiKey),
      ...(params.jurisdiction ? { 'cf-r2-jurisdiction': params.jurisdiction } : {}),
    }),
  },
  transformResponse: async (response) => {
    const data = await readCloudflareResponse(response)
    const success = response.ok && data.success === true && isRecordLike(data.result)
    return {
      success,
      output: mapCloudflareFields(data.result, R2_CORS_OUTPUTS),
      ...(!success ? { error: cloudflareErrorMessage(data, 'Failed to get r2 bucket cors') } : {}),
    }
  },
  outputs: R2_CORS_OUTPUTS,
}
