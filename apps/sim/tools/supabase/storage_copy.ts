import type { SupabaseStorageCopyParams, SupabaseStorageCopyResponse } from '@/tools/supabase/types'
import type { ToolConfig } from '@/tools/types'

export const storageCopyTool: ToolConfig<SupabaseStorageCopyParams, SupabaseStorageCopyResponse> = {
  id: 'supabase_storage_copy',
  name: 'Supabase Storage Copy',
  description: 'Copy a file within a Supabase storage bucket',
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
    fromPath: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The path of the source file (e.g., "folder/source.jpg")',
    },
    toPath: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The path for the copied file (e.g., "folder/copy.jpg")',
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
      return `https://${params.projectId}.supabase.co/storage/v1/object/copy`
    },
    method: 'POST',
    headers: (params) => ({
      apikey: params.apiKey,
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      return {
        bucketId: params.bucket,
        sourceKey: params.fromPath,
        destinationKey: params.toPath,
      }
    },
  },

  transformResponse: async (response: Response) => {
    let data
    try {
      data = await response.json()
    } catch (parseError) {
      throw new Error(`Failed to parse Supabase storage copy response: ${parseError}`)
    }

    return {
      success: true,
      output: {
        message: 'Successfully copied file in storage',
        results: data,
      },
      error: undefined,
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    results: {
      type: 'object',
      description: 'Copy operation result',
    },
  },
}
