import type {
  SupabaseStorageCreateSignedUrlParams,
  SupabaseStorageCreateSignedUrlResponse,
} from '@/tools/supabase/types'
import type { ToolConfig } from '@/tools/types'

export const storageCreateSignedUrlTool: ToolConfig<
  SupabaseStorageCreateSignedUrlParams,
  SupabaseStorageCreateSignedUrlResponse
> = {
  id: 'supabase_storage_create_signed_url',
  name: 'Supabase Storage Create Signed URL',
  description: 'Create a temporary signed URL for a file in a Supabase storage bucket',
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
    expiresIn: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Number of seconds until the URL expires (e.g., 3600 for 1 hour)',
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
      return `https://${params.projectId}.supabase.co/storage/v1/object/sign/${params.bucket}/${params.path}`
    },
    method: 'POST',
    headers: (params) => ({
      apikey: params.apiKey,
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const payload: any = {
        expiresIn: Number(params.expiresIn),
      }

      if (params.download !== undefined) {
        payload.download = params.download
      }

      return payload
    },
  },

  transformResponse: async (response: Response, params?: SupabaseStorageCreateSignedUrlParams) => {
    let data
    try {
      data = await response.json()
    } catch (parseError) {
      throw new Error(`Failed to parse Supabase storage create signed URL response: ${parseError}`)
    }

    const relativePath = data.signedURL || data.signedUrl
    const fullUrl = `https://${params?.projectId}.supabase.co/storage/v1${relativePath}`

    return {
      success: true,
      output: {
        message: 'Successfully created signed URL',
        signedUrl: fullUrl,
      },
      error: undefined,
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    signedUrl: {
      type: 'string',
      description: 'The temporary signed URL to access the file',
    },
  },
}
