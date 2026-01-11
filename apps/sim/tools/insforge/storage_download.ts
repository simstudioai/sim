import { createLogger } from '@/lib/logs/console/logger'
import type {
  InsForgeStorageDownloadParams,
  InsForgeStorageDownloadResponse,
} from '@/tools/insforge/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('InsForgeStorageDownloadTool')

export const storageDownloadTool: ToolConfig<
  InsForgeStorageDownloadParams,
  InsForgeStorageDownloadResponse
> = {
  id: 'insforge_storage_download',
  name: 'InsForge Storage Download',
  description: 'Download a file from an InsForge storage bucket',
  version: '1.0',

  params: {
    baseUrl: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your InsForge backend URL (e.g., https://your-app.insforge.app)',
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
      description: 'Your InsForge anon key or service role key',
    },
  },

  request: {
    url: (params) => {
      const base = params.baseUrl.replace(/\/$/, '')
      return `${base}/api/storage/buckets/${params.bucket}/objects/${params.path}`
    },
    method: 'GET',
    headers: (params) => ({
      apikey: params.apiKey,
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response: Response, params?: InsForgeStorageDownloadParams) => {
    try {
      if (!response.ok) {
        logger.error('Failed to download file from InsForge storage', {
          status: response.status,
          statusText: response.statusText,
        })
        throw new Error(`Failed to download file: ${response.statusText}`)
      }

      const contentType = response.headers.get('content-type') || 'application/octet-stream'

      const pathParts = params?.path?.split('/') || []
      const defaultFileName = pathParts[pathParts.length - 1] || 'download'
      const resolvedName = params?.fileName || defaultFileName

      logger.info('Downloading file from InsForge storage', {
        bucket: params?.bucket,
        path: params?.path,
        fileName: resolvedName,
        contentType,
      })

      const arrayBuffer = await response.arrayBuffer()
      const fileBuffer = Buffer.from(arrayBuffer)

      logger.info('File downloaded successfully from InsForge storage', {
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
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      const errorStack = error instanceof Error ? error.stack : undefined
      logger.error('Error downloading file from InsForge storage', {
        error: errorMessage,
        stack: errorStack,
      })
      throw error
    }
  },

  outputs: {
    file: { type: 'file', description: 'Downloaded file stored in execution files' },
  },
}
