import type {
  SupabaseStorageListBucketsParams,
  SupabaseStorageListBucketsResponse,
} from '@/tools/supabase/types'
import type { ToolConfig } from '@/tools/types'

export const storageListBucketsTool: ToolConfig<
  SupabaseStorageListBucketsParams,
  SupabaseStorageListBucketsResponse
> = {
  id: 'supabase_storage_list_buckets',
  name: 'Supabase Storage List Buckets',
  description: 'List all storage buckets in Supabase',
  version: '1.0',

  params: {
    projectId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your Supabase project ID (e.g., jdrkgepadsdopsntdlom)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your Supabase service role secret key',
    },
  },

  request: {
    url: (params) => {
      return `https://${params.projectId}.supabase.co/storage/v1/bucket`
    },
    method: 'GET',
    headers: (params) => ({
      apikey: params.apiKey,
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response: Response) => {
    let data
    try {
      data = await response.json()
    } catch (parseError) {
      throw new Error(`Failed to parse Supabase storage list buckets response: ${parseError}`)
    }

    const bucketCount = Array.isArray(data) ? data.length : 0

    return {
      success: true,
      output: {
        message: `Successfully listed ${bucketCount} bucket${bucketCount === 1 ? '' : 's'}`,
        results: data,
      },
      error: undefined,
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    results: {
      type: 'array',
      description: 'Array of bucket objects',
    },
  },
}
