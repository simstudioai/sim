import { createInternalToolOperationInput } from '@/tools/operation-input'
import {
  STORAGE_MESSAGE_OUTPUT_PROPERTIES,
  type SupabaseStorageUpdateBucketParams,
  type SupabaseStorageUpdateBucketResponse,
} from '@/tools/supabase/types'
import type { InternalToolConfig } from '@/tools/types'

export const storageUpdateBucketTool: InternalToolConfig<
  SupabaseStorageUpdateBucketParams,
  SupabaseStorageUpdateBucketResponse
> = {
  id: 'supabase_storage_update_bucket',
  name: 'Supabase Storage Update Bucket',
  description: 'Update the configuration of an existing Supabase storage bucket',
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
      description: 'The name of the bucket to update',
    },
    isPublic: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Whether the bucket should be publicly accessible (leave unset to keep the current value)',
    },
    fileSizeLimit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum file size in bytes (leave unset to keep the current value)',
    },
    allowedMimeTypes: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Array of allowed MIME types (e.g., ["image/png", "image/jpeg"]) — leave unset to keep the current value',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your Supabase service role secret key',
    },
  },

  operation: {
    input: createInternalToolOperationInput,
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    results: {
      type: 'object',
      description: 'Update operation result',
      properties: STORAGE_MESSAGE_OUTPUT_PROPERTIES,
    },
  },
}
