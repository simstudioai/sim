import type {
  SupabaseStorageGetPublicUrlParams,
  SupabaseStorageGetPublicUrlResponse,
} from '@/tools/supabase/types'
import type { ToolConfig } from '@/tools/types'

export const storageGetPublicUrlTool: ToolConfig<
  SupabaseStorageGetPublicUrlParams,
  SupabaseStorageGetPublicUrlResponse
> = {
  id: 'supabase_storage_get_public_url',
  name: 'Supabase Storage Get Public URL',
  description: 'Get the public URL for a file in a Supabase storage bucket',
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
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your Supabase service role secret key',
    },
  },

  request: {
    url: (params) => {
      // For public URL, we don't actually need to make a request
      // We can construct it directly
      let url = `https://${params.projectId}.supabase.co/storage/v1/object/public/${params.bucket}/${params.path}`

      if (params.download) {
        url += '?download=true'
      }

      // Return a dummy URL that won't be called
      return url
    },
    method: 'GET',
    headers: (params) => ({
      apikey: params.apiKey,
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response: Response) => {
    // The URL is already constructed in the request.url
    // We just need to return it
    const publicUrl = response.url

    return {
      success: true,
      output: {
        message: 'Successfully generated public URL',
        publicUrl: publicUrl,
      },
      error: undefined,
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    publicUrl: {
      type: 'string',
      description: 'The public URL to access the file',
    },
  },
}
