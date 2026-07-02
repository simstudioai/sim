import type {
  SupabaseStorageGetPublicUrlParams,
  SupabaseStorageGetPublicUrlResponse,
} from '@/tools/supabase/types'
import { encodeStoragePath, encodeStorageSegment, supabaseBaseUrl } from '@/tools/supabase/utils'
import type { ToolConfig } from '@/tools/types'

export const storageGetPublicUrlTool: ToolConfig<
  SupabaseStorageGetPublicUrlParams,
  SupabaseStorageGetPublicUrlResponse
> = {
  id: 'supabase_storage_get_public_url',
  name: 'Supabase Storage Get Public URL',
  description: 'Get the public URL for a file in a Supabase storage bucket',
  version: '1.0.0',

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
      description: 'The name of the storage bucket',
    },
    path: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The path to the file (e.g., "folder/file.jpg")',
    },
    download: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'If true, forces download instead of inline display (default: false)',
    },
  },

  /**
   * Public URLs are deterministic and built entirely from the project ID,
   * bucket, and path — no network request is required. `directExecution`
   * short-circuits the HTTP request so we never hit the API just to discard
   * its response.
   */
  directExecution: async (params: SupabaseStorageGetPublicUrlParams) => {
    const bucket = encodeStorageSegment(params.bucket)
    const path = encodeStoragePath(params.path)
    let publicUrl = `${supabaseBaseUrl(params.projectId)}/storage/v1/object/public/${bucket}/${path}`

    if (params.download) {
      publicUrl += '?download=true'
    }

    return {
      success: true,
      output: {
        message: 'Successfully generated public URL',
        publicUrl,
      },
      error: undefined,
    }
  },

  request: {
    url: (params) => {
      const bucket = encodeStorageSegment(params.bucket)
      const path = encodeStoragePath(params.path)
      return `${supabaseBaseUrl(params.projectId)}/storage/v1/object/public/${bucket}/${path}`
    },
    method: 'GET',
    headers: () => ({}),
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    publicUrl: {
      type: 'string',
      description: 'The public URL to access the file',
    },
  },
}
