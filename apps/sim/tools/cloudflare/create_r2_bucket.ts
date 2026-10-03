import type {
  CloudflareCreateR2BucketParams,
  CloudflareR2BucketResponse,
} from '@/tools/cloudflare/types'
import { cloudflareErrorMessage, cloudflareHeaders } from '@/tools/cloudflare/utils'
import type { ToolConfig } from '@/tools/types'

export const createR2BucketTool: ToolConfig<
  CloudflareCreateR2BucketParams,
  CloudflareR2BucketResponse
> = {
  id: 'cloudflare_create_r2_bucket',
  name: 'Cloudflare Create R2 Bucket',
  description:
    'Creates an R2 object storage bucket in an account. The location hint and jurisdiction are fixed at creation and cannot be changed later. Requires an API token with Account Workers R2 Storage Edit.',
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
      description: 'Name for the new bucket',
    },
    locationHint: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Region hint for where the bucket should live: apac, eeur, enam, weur, wnam, or oc. Cannot be changed after creation',
    },
    storageClass: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Default storage class for objects: Standard or InfrequentAccess',
    },
    jurisdiction: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Data-residency jurisdiction to create the bucket in: default, eu, or fedramp. Cannot be changed after creation',
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
      `https://api.cloudflare.com/client/v4/accounts/${params.accountId.trim()}/r2/buckets`,
    method: 'POST',
    headers: (params) => {
      const headers = cloudflareHeaders(params.apiKey)
      if (params.jurisdiction) headers['cf-r2-jurisdiction'] = params.jurisdiction
      return headers
    },
    body: (params) => {
      const body: Record<string, unknown> = { name: params.bucketName }
      if (params.locationHint) body.locationHint = params.locationHint
      if (params.storageClass) body.storageClass = params.storageClass
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      return {
        success: false,
        output: {
          name: '',
          creation_date: null,
          location: null,
          storage_class: null,
          jurisdiction: null,
        },
        error: cloudflareErrorMessage(data, 'Failed to create R2 bucket'),
      }
    }

    const bucket = data.result
    return {
      success: true,
      output: {
        name: bucket?.name ?? '',
        creation_date: bucket?.creation_date ?? null,
        location: bucket?.location ?? null,
        storage_class: bucket?.storage_class ?? null,
        jurisdiction: bucket?.jurisdiction ?? null,
      },
    }
  },

  outputs: {
    name: { type: 'string', description: 'Created bucket name' },
    creation_date: { type: 'string', description: 'Creation timestamp', optional: true },
    location: {
      type: 'string',
      description: 'Location the bucket was created in',
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
}
