import type {
  SupabaseStorageCreateBucketParams,
  SupabaseStorageCreateBucketResponse,
} from '@/tools/supabase/types'
import type { ToolConfig } from '@/tools/types'

export const storageCreateBucketTool: ToolConfig<
  SupabaseStorageCreateBucketParams,
  SupabaseStorageCreateBucketResponse
> = {
  id: 'supabase_storage_create_bucket',
  name: 'Supabase Storage Create Bucket',
  description: 'Create a new storage bucket in Supabase',
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
      description: 'The name of the bucket to create',
    },
    isPublic: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the bucket should be publicly accessible (default: false)',
    },
    fileSizeLimit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum file size in bytes (optional)',
    },
    allowedMimeTypes: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Array of allowed MIME types (e.g., ["image/png", "image/jpeg"])',
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
    method: 'POST',
    headers: (params) => ({
      apikey: params.apiKey,
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const payload: any = {
        id: params.bucket,
        name: params.bucket,
        public: params.isPublic || false,
      }

      if (params.fileSizeLimit) {
        payload.file_size_limit = Number(params.fileSizeLimit)
      }

      if (params.allowedMimeTypes && params.allowedMimeTypes.length > 0) {
        payload.allowed_mime_types = params.allowedMimeTypes
      }

      return payload
    },
  },

  transformResponse: async (response: Response) => {
    let data
    try {
      data = await response.json()
    } catch (parseError) {
      throw new Error(`Failed to parse Supabase storage create bucket response: ${parseError}`)
    }

    return {
      success: true,
      output: {
        message: 'Successfully created storage bucket',
        results: data,
      },
      error: undefined,
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    results: {
      type: 'object',
      description: 'Created bucket information',
    },
  },
}
