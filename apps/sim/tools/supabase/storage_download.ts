import type {
  SupabaseStorageDownloadParams,
  SupabaseStorageDownloadResponse,
} from '@/tools/supabase/types'
import type { ToolConfig } from '@/tools/types'

export const storageDownloadTool: ToolConfig<
  SupabaseStorageDownloadParams,
  SupabaseStorageDownloadResponse
> = {
  id: 'supabase_storage_download',
  name: 'Supabase Storage Download',
  description: 'Download a file from a Supabase storage bucket',
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
      description: 'The path to the file to download (e.g., "folder/file.jpg")',
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
    method: 'GET',
    headers: (params) => ({
      apikey: params.apiKey,
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response: Response) => {
    // Get the content type
    const contentType = response.headers.get('content-type') || 'application/octet-stream'

    // Check if it's a text-based file
    const isText =
      contentType.startsWith('text/') ||
      contentType.includes('json') ||
      contentType.includes('xml') ||
      contentType.includes('javascript') ||
      contentType.includes('html')

    let fileContent: string
    if (isText) {
      // Return text content as-is
      fileContent = await response.text()
    } else {
      // Return binary content as base64
      const buffer = await response.arrayBuffer()
      const bytes = new Uint8Array(buffer)
      let binary = ''
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i])
      }
      fileContent = btoa(binary)
    }

    return {
      success: true,
      output: {
        message: 'Successfully downloaded file from storage',
        fileContent: fileContent,
        contentType: contentType,
        isBase64: !isText,
      },
      error: undefined,
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    fileContent: {
      type: 'string',
      description: 'File content (base64 encoded if binary, plain text otherwise)',
    },
    contentType: { type: 'string', description: 'MIME type of the file' },
    isBase64: {
      type: 'boolean',
      description: 'Whether the file content is base64 encoded',
    },
  },
}
