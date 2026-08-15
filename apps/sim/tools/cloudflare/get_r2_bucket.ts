import type {
  CloudflareGetR2BucketParams,
  CloudflareR2BucketResponse,
} from '@/tools/cloudflare/types'
import { cloudflareErrorMessage, cloudflareHeaders } from '@/tools/cloudflare/utils'
import type { ToolConfig } from '@/tools/types'

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
        `https://api.cloudflare.com/client/v4/accounts/${params.accountId.trim()}/r2/buckets/${encodeURIComponent(params.bucketName)}`,
      method: 'GET',
      headers: (params) => {
        const headers = cloudflareHeaders(params.apiKey)
        if (params.jurisdiction) headers['cf-r2-jurisdiction'] = params.jurisdiction
        return headers
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
          error: cloudflareErrorMessage(data, 'Failed to get R2 bucket'),
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
  }
