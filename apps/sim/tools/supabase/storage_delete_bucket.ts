import type {
  SupabaseStorageDeleteBucketParams,
  SupabaseStorageDeleteBucketResponse,
} from '@/tools/supabase/types'
import type { ToolConfig } from '@/tools/types'

export const storageDeleteBucketTool: ToolConfig<
  SupabaseStorageDeleteBucketParams,
  SupabaseStorageDeleteBucketResponse
> = {
  id: 'supabase_storage_delete_bucket',
  name: 'Supabase Storage Delete Bucket',
  description: 'Delete a storage bucket in Supabase',
  version: '1.0',

  params: {
    projectId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your Supabase project ID (e.g., jdrkgepadsdopsntdlom)',
    },
    bucket: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The name of the bucket to delete',
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
      return `https://${params.projectId}.supabase.co/storage/v1/bucket/${params.bucket}`
    },
    method: 'DELETE',
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
      throw new Error(`Failed to parse Supabase storage delete bucket response: ${parseError}`)
    }

    return {
      success: true,
      output: {
        message: 'Successfully deleted storage bucket',
        results: data,
      },
      error: undefined,
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    results: {
      type: 'object',
      description: 'Delete operation result',
    },
  },
}
