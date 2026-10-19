import { isRecordLike } from '@sim/utils/object'
import { R2_BUCKET_OUTPUTS } from '@/tools/cloudflare/outputs'
import type {
  CloudflareGetR2BucketParams,
  CloudflareR2BucketResponse,
} from '@/tools/cloudflare/types'
import {
  cloudflareErrorMessage,
  cloudflareHeaders,
  mapCloudflareFields,
  readCloudflareResponse,
} from '@/tools/cloudflare/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const getR2BucketTool: ToolConfig<CloudflareGetR2BucketParams, CloudflareR2BucketResponse> =
  {
    id: 'cloudflare_get_r2_bucket',
    name: 'Cloudflare Get R2 Bucket',
    description:
      'Reads the metadata of a single R2 object storage bucket. Requires an API token with Account Workers R2 Storage Read.',
    version: '1.0.0',

    params: {
      accountId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'The Cloudflare account ID. R2 buckets are account-scoped',
      },
      bucketName: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'The name of the bucket to read',
      },
      jurisdiction: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Data-residency jurisdiction the bucket lives in: default, eu, or fedramp',
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
        `https://api.cloudflare.com/client/v4/accounts/${safeUrlPathSegment(params.accountId, 'accountId')}/r2/buckets/${safeUrlPathSegment(params.bucketName, 'bucketName')}`,
      method: 'GET',
      headers: (params) => {
        const headers = cloudflareHeaders(params.apiKey)
        if (params.jurisdiction) headers['cf-r2-jurisdiction'] = params.jurisdiction
        return headers
      },
    },

    transformResponse: async (response: Response) => {
      const data = await readCloudflareResponse(response)
      const success = response.ok && data.success === true && isRecordLike(data.result)
      return {
        success,
        output: mapCloudflareFields(data.result, R2_BUCKET_OUTPUTS),
        ...(!success ? { error: cloudflareErrorMessage(data, 'Failed to get r2 bucket') } : {}),
      }
    },
    outputs: R2_BUCKET_OUTPUTS,
  }
