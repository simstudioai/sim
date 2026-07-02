import type {
  SupabaseStorageCreateSignedUploadUrlParams,
  SupabaseStorageCreateSignedUploadUrlResponse,
} from '@/tools/supabase/types'
import { encodeStoragePath, encodeStorageSegment, supabaseBaseUrl } from '@/tools/supabase/utils'
import type { ToolConfig } from '@/tools/types'

export const storageCreateSignedUploadUrlTool: ToolConfig<
  SupabaseStorageCreateSignedUploadUrlParams,
  SupabaseStorageCreateSignedUploadUrlResponse
> = {
  id: 'supabase_storage_create_signed_upload_url',
  name: 'Supabase Storage Create Signed Upload URL',
  description:
    'Create a temporary signed URL a client can use to upload directly to a Supabase storage bucket',
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
      description: 'The destination path for the uploaded file (e.g., "folder/file.jpg")',
    },
    upsert: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'If true, allows overwriting an existing file at this path (default: false)',
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
      const bucket = encodeStorageSegment(params.bucket)
      const path = encodeStoragePath(params.path)
      return `${supabaseBaseUrl(params.projectId)}/storage/v1/object/upload/sign/${bucket}/${path}`
    },
    method: 'POST',
    headers: (params) => ({
      apikey: params.apiKey,
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
      ...(params.upsert ? { 'x-upsert': 'true' } : {}),
    }),
    body: () => ({}),
  },

  transformResponse: async (
    response: Response,
    params?: SupabaseStorageCreateSignedUploadUrlParams
  ) => {
    let data
    try {
      data = await response.json()
    } catch (parseError) {
      throw new Error(
        `Failed to parse Supabase storage create signed upload URL response: ${parseError}`
      )
    }

    const relativeUrl = data.url
    if (!relativeUrl) {
      throw new Error('Supabase did not return a signed upload URL path in its response')
    }
    if (!params?.projectId) {
      throw new Error('projectId is required to construct the signed upload URL')
    }

    return {
      success: true,
      output: {
        message: 'Successfully created signed upload URL',
        signedUrl: `${supabaseBaseUrl(params.projectId)}/storage/v1${relativeUrl}`,
        path: data.path,
        token: data.token,
      },
      error: undefined,
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    signedUrl: {
      type: 'string',
      description: 'The temporary signed URL a client can PUT the file to',
    },
    path: { type: 'string', description: 'The destination object path' },
    token: { type: 'string', description: 'The upload token embedded in the signed URL' },
  },
}
