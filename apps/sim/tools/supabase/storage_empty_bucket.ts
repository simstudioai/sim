import {
  STORAGE_MESSAGE_OUTPUT_PROPERTIES,
  type SupabaseStorageEmptyBucketParams,
  type SupabaseStorageEmptyBucketResponse,
} from '@/tools/supabase/types'
import { encodeStorageSegment, supabaseBaseUrl } from '@/tools/supabase/utils'
import type { ToolConfig } from '@/tools/types'

export const storageEmptyBucketTool: ToolConfig<
  SupabaseStorageEmptyBucketParams,
  SupabaseStorageEmptyBucketResponse
> = {
  id: 'supabase_storage_empty_bucket',
  name: 'Supabase Storage Empty Bucket',
  description:
    'Delete all objects inside a Supabase storage bucket without deleting the bucket itself',
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
      description: 'The name of the bucket to empty',
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
      return `${supabaseBaseUrl(params.projectId)}/storage/v1/bucket/${bucket}/empty`
    },
    method: 'POST',
    headers: (params) => ({
      apikey: params.apiKey,
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: () => ({}),
  },

  transformResponse: async (response: Response) => {
    let data
    try {
      data = await response.json()
    } catch (parseError) {
      throw new Error(`Failed to parse Supabase storage empty bucket response: ${parseError}`)
    }

    return {
      success: true,
      output: {
        message: data.message || 'Successfully emptied storage bucket',
        results: data,
      },
      error: undefined,
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    results: {
      type: 'object',
      description: 'Empty bucket operation result',
      properties: STORAGE_MESSAGE_OUTPUT_PROPERTIES,
    },
  },
}
