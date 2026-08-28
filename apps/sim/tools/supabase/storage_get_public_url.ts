import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  SupabaseStorageGetPublicUrlParams,
  SupabaseStorageGetPublicUrlResponse,
} from '@/tools/supabase/types'
import type { InternalToolConfig } from '@/tools/types'

export const storageGetPublicUrlTool: InternalToolConfig<
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

  operation: {
    input: createInternalToolOperationInput,
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    publicUrl: {
      type: 'string',
      description: 'The public URL to access the file',
    },
  },
}
