import type { SupabaseStorageMoveParams, SupabaseStorageMoveResponse } from '@/tools/supabase/types'
import type { ToolConfig } from '@/tools/types'

export const storageMoveTool: ToolConfig<SupabaseStorageMoveParams, SupabaseStorageMoveResponse> = {
  id: 'supabase_storage_move',
  name: 'Supabase Storage Move',
  description: 'Move a file within a Supabase storage bucket',
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
      description: 'The current path of the file (e.g., "folder/old.jpg")',
    },
    toPath: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The new path for the file (e.g., "newfolder/new.jpg")',
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
      return `https://${params.projectId}.supabase.co/storage/v1/object/move`
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
      throw new Error(`Failed to parse Supabase storage move response: ${parseError}`)
    }

    return {
      success: true,
      output: {
        message: 'Successfully moved file in storage',
        results: data,
      },
      error: undefined,
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    results: {
      type: 'object',
      description: 'Move operation result',
    },
  },
}
