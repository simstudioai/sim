import {
  STORAGE_UPLOAD_OUTPUT_PROPERTIES,
  type SupabaseStorageUploadParams,
  type SupabaseStorageUploadResponse,
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
    fileName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The name of the file (e.g., "document.pdf", "image.jpg")',
    },
    path: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional folder path (e.g., "folder/subfolder/")',
    },
    fileData: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'File to upload - UserFile object (basic mode) or string content (advanced mode: base64 or plain text). Supports data URLs.',
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
    url: '/api/tools/supabase/storage-upload',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      projectId: params.projectId,
      apiKey: params.apiKey,
      bucket: params.bucket,
      fileName: params.fileName,
      path: params.path,
      fileData: params.fileData,
      contentType: params.contentType,
      upsert: params.upsert,
    }),
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    results: {
      type: 'object',
      description: 'Upload result including file path, bucket, and public URL',
      properties: STORAGE_UPLOAD_OUTPUT_PROPERTIES,
    },
  },
}
