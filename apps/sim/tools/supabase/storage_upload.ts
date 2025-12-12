import type {
  SupabaseStorageUploadParams,
  SupabaseStorageUploadResponse,
} from '@/tools/supabase/types'
import type { ToolConfig } from '@/tools/types'

export const storageUploadTool: ToolConfig<
  SupabaseStorageUploadParams,
  SupabaseStorageUploadResponse
> = {
  id: 'supabase_storage_upload',
  name: 'Supabase Storage Upload',
  description: 'Upload a file to a Supabase storage bucket',
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
      description: 'The path where the file will be stored (e.g., "folder/file.jpg")',
    },
    fileContent: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The file content (base64 encoded for binary files, or plain text)',
    },
    contentType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'MIME type of the file (e.g., "image/jpeg", "text/plain")',
    },
    upsert: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'If true, overwrites existing file (default: false)',
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
      return `https://${params.projectId}.supabase.co/storage/v1/object/${params.bucket}/${params.path}`
    },
    method: 'POST',
    headers: (params) => {
      const headers: Record<string, string> = {
        apikey: params.apiKey,
        Authorization: `Bearer ${params.apiKey}`,
      }

      if (params.contentType) {
        headers['Content-Type'] = params.contentType
      }

      if (params.upsert) {
        headers['x-upsert'] = 'true'
      }

      return headers
    },
    body: (params) => {
      // Return the file content wrapped in an object
      // The actual upload will need to handle this appropriately
      return {
        content: params.fileContent,
      }
    },
  },

  transformResponse: async (response: Response) => {
    let data
    try {
      data = await response.json()
    } catch (parseError) {
      throw new Error(`Failed to parse Supabase storage upload response: ${parseError}`)
    }

    return {
      success: true,
      output: {
        message: 'Successfully uploaded file to storage',
        results: data,
      },
      error: undefined,
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    results: {
      type: 'object',
      description: 'Upload result including file path and metadata',
    },
  },
}
