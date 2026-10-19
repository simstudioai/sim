import type {
  CloudflareUpdateR2BucketLifecycleParams,
  CloudflareUpdateR2BucketLifecycleResponse,
} from '@/tools/cloudflare/operation-types'
import {
  cloudflareErrorMessage,
  cloudflareHeaders,
  parseJsonArrayParam,
  readCloudflareResponse,
} from '@/tools/cloudflare/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const updateR2BucketLifecycleTool: ToolConfig<
  CloudflareUpdateR2BucketLifecycleParams,
  CloudflareUpdateR2BucketLifecycleResponse
> = {
  id: 'cloudflare_update_r2_bucket_lifecycle',
  name: 'Cloudflare Update R2 Bucket Lifecycle',
  description:
    'Replaces the object lifecycle rules for an R2 bucket. Rules match object-key prefixes and can expire objects, abort incomplete multipart uploads, or transition objects to Infrequent Access storage. Replaces the configuration; resend all values to retain.',
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
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Complete JSON array of lifecycle rules. Read the current rules first and include every rule to retain. Use [] only to remove all lifecycle rules. Fields: abortMultipartUploadsTransition, conditions, deleteObjectsTransition, enabled, id, storageClassTransitions.',
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
      `https://api.cloudflare.com/client/v4/accounts/${safeUrlPathSegment(params.accountId, 'accountId')}/r2/buckets/${safeUrlPathSegment(params.bucketName, 'bucketName')}/lifecycle`,
    method: 'PUT',
    headers: (params) => ({
      ...cloudflareHeaders(params.apiKey),
      ...(params.jurisdiction ? { 'cf-r2-jurisdiction': params.jurisdiction } : {}),
    }),
    body: (params) => {
      const rules = parseJsonArrayParam(params.rules, 'rules')
      if (rules === undefined) {
        throw new Error(
          'rules is required; supply a JSON array or [] to remove all lifecycle rules'
        )
      }
      return { rules }
    },
  },
  transformResponse: async (response) => {
    const data = await readCloudflareResponse(response)
    const success = response.ok && data.success === true
    return {
      success,
      output: { success },
      ...(!success
        ? { error: cloudflareErrorMessage(data, 'Failed to update r2 bucket lifecycle') }
        : {}),
    }
  },
  outputs: {
    success: { type: 'boolean', description: 'Whether Cloudflare accepted the operation' },
  },
}
