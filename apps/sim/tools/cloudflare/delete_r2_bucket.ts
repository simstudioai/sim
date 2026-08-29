import type {
  CloudflareDeleteR2BucketParams,
  CloudflareDeleteR2BucketResponse,
} from '@/tools/cloudflare/types'
import { cloudflareErrorMessage, cloudflareHeaders } from '@/tools/cloudflare/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const deleteR2BucketTool: ToolConfig<
  CloudflareDeleteR2BucketParams,
  CloudflareDeleteR2BucketResponse
> = {
  id: 'cloudflare_delete_r2_bucket',
  name: 'Cloudflare Delete R2 Bucket',
  description:
    'Permanently deletes an R2 object storage bucket. Cloudflare only deletes an empty bucket, and the deletion cannot be undone. Requires an API token with Account Workers R2 Storage Edit.',
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
      description: 'The name of the bucket to delete permanently',
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
    method: 'DELETE',
    headers: (params) => {
      const headers = cloudflareHeaders(params.apiKey)
      if (params.jurisdiction) headers['cf-r2-jurisdiction'] = params.jurisdiction
      return headers
    },
  },

  transformResponse: async (response: Response, params) => {
    const data = await response.json()

    if (!data.success) {
      return {
        success: false,
        output: { name: '' },
        error: cloudflareErrorMessage(data, 'Failed to delete R2 bucket'),
      }
    }

    /**
     * Echo the name the request actually addressed. `safeUrlPathSegment` trims
     * before building the path, so reporting the raw param would name a bucket
     * that was not the one deleted whenever the input carried whitespace.
     */
    const deleted = params?.bucketName
    return {
      success: true,
      output: { name: typeof deleted === 'string' ? deleted.trim() : (deleted ?? '') },
    }
  },

  outputs: {
    name: {
      type: 'string',
      description:
        'Name of the deleted bucket. Cloudflare returns an empty result body for this endpoint, so the name is echoed from the request',
    },
  },
}
