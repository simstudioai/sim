import type {
  SupabaseStorageDeleteParams,
  SupabaseStorageDeleteResponse,
} from '@/tools/supabase/types'
import type { ToolConfig } from '@/tools/types'

export const storageDeleteTool: ToolConfig<
  SupabaseStorageDeleteParams,
  SupabaseStorageDeleteResponse
> = {
  id: 'supabase_storage_delete',
  name: 'Supabase Storage Delete',
  description: 'Delete files from a Supabase storage bucket',
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
      description: 'The name of the storage bucket',
    },
    paths: {
      type: 'array',
      required: true,
      visibility: 'user-or-llm',
      description: 'Array of file paths to delete (e.g., ["folder/file1.jpg", "folder/file2.jpg"])',
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
      return `https://${params.projectId}.supabase.co/storage/v1/object/${params.bucket}`
    },
    method: 'DELETE',
    headers: (params) => ({
      apikey: params.apiKey,
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      return {
        prefixes: params.paths,
      }
    },
  },

  transformResponse: async (response: Response) => {
    let data
    try {
      data = await response.json()
    } catch (parseError) {
      throw new Error(`Failed to parse Supabase storage delete response: ${parseError}`)
    }

    return {
      success: true,
      output: {
        message: 'Successfully deleted files from storage',
        results: data,
      },
      error: undefined,
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    results: {
      type: 'array',
      description: 'Array of deleted file objects',
    },
  },
}
