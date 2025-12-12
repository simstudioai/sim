import { createLogger } from '@/lib/logs/console/logger'
import type {
  SupabaseStorageDownloadParams,
  SupabaseStorageDownloadResponse,
} from '@/tools/supabase/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('SupabaseStorageDownloadTool')

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
    fileName: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Optional filename override',
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

  transformResponse: async (response: Response, params?: SupabaseStorageDownloadParams) => {
    try {
      if (!response.ok) {
        logger.error('Failed to download file from Supabase storage', {
          status: response.status,
          statusText: response.statusText,
        })
        throw new Error(`Failed to download file: ${response.statusText}`)
      }

      const contentType = response.headers.get('content-type') || 'application/octet-stream'

      const pathParts = params?.path?.split('/') || []
      const defaultFileName = pathParts[pathParts.length - 1] || 'download'
      const resolvedName = params?.fileName || defaultFileName

      logger.info('Downloading file from Supabase storage', {
        bucket: params?.bucket,
        path: params?.path,
        fileName: resolvedName,
        contentType,
      })

      const arrayBuffer = await response.arrayBuffer()
      const fileBuffer = Buffer.from(arrayBuffer)

      logger.info('File downloaded successfully from Supabase storage', {
        name: resolvedName,
        size: fileBuffer.length,
        contentType,
      })

      const base64Data = fileBuffer.toString('base64')

      return {
        success: true,
        output: {
          file: {
            name: resolvedName,
            mimeType: contentType,
            data: base64Data,
            size: fileBuffer.length,
          },
        },
        error: undefined,
      }
    } catch (error: any) {
      logger.error('Error downloading file from Supabase storage', {
        error: error.message,
        stack: error.stack,
      })
      throw error
    }
  },

  outputs: {
    file: { type: 'file', description: 'Downloaded file stored in execution files' },
  },
}
