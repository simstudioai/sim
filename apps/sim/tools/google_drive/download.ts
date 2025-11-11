import { createLogger } from '@/lib/logs/console/logger'
import type { GoogleDriveDownloadResponse, GoogleDriveToolParams } from '@/tools/google_drive/types'
import { DEFAULT_EXPORT_FORMATS, GOOGLE_WORKSPACE_MIME_TYPES } from '@/tools/google_drive/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('GoogleDriveDownloadTool')

export const downloadTool: ToolConfig<GoogleDriveToolParams, GoogleDriveDownloadResponse> = {
  id: 'google_drive_download',
  name: 'Download File from Google Drive',
  description: 'Download a file from Google Drive (exports Google Workspace files automatically)',
  version: '1.0',

  oauth: {
    required: true,
    provider: 'google-drive',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'The access token for the Google Drive API',
    },
    fileId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The ID of the file to download',
    },
    mimeType: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'The MIME type to export Google Workspace files to (optional)',
    },
    fileName: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Optional filename override',
    },
  },

  request: {
    url: (params) =>
      `https://www.googleapis.com/drive/v3/files/${params.fileId}?fields=id,name,mimeType`,
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response: Response, params?: GoogleDriveToolParams) => {
    try {
      if (!response.ok) {
        const errorDetails = await response.json().catch(() => ({}))
        logger.error('Failed to get file metadata', {
          status: response.status,
          statusText: response.statusText,
          error: errorDetails,
        })
        throw new Error(errorDetails.error?.message || 'Failed to get file metadata')
      }

      const metadata = await response.json()
      const fileId = metadata.id
      const mimeType = metadata.mimeType
      const authHeader = `Bearer ${params?.accessToken || ''}`

      let fileBuffer: Buffer
      let finalMimeType = mimeType

      if (GOOGLE_WORKSPACE_MIME_TYPES.includes(mimeType)) {
        const exportFormat = params?.mimeType || DEFAULT_EXPORT_FORMATS[mimeType] || 'text/plain'
        finalMimeType = exportFormat

        logger.info('Exporting Google Workspace file', {
          fileId,
          mimeType,
          exportFormat,
        })

        const exportResponse = await fetch(
          `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=${encodeURIComponent(exportFormat)}`,
          {
            headers: {
              Authorization: authHeader,
            },
          }
        )

        if (!exportResponse.ok) {
          const exportError = await exportResponse.json().catch(() => ({}))
          logger.error('Failed to export file', {
            status: exportResponse.status,
            statusText: exportResponse.statusText,
            error: exportError,
          })
          throw new Error(exportError.error?.message || 'Failed to export Google Workspace file')
        }

        const arrayBuffer = await exportResponse.arrayBuffer()
        fileBuffer = Buffer.from(arrayBuffer)
      } else {
        logger.info('Downloading regular file', {
          fileId,
          mimeType,
        })

        const downloadResponse = await fetch(
          `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
          {
            headers: {
              Authorization: authHeader,
            },
          }
        )

        if (!downloadResponse.ok) {
          const downloadError = await downloadResponse.json().catch(() => ({}))
          logger.error('Failed to download file', {
            status: downloadResponse.status,
            statusText: downloadResponse.statusText,
            error: downloadError,
          })
          throw new Error(downloadError.error?.message || 'Failed to download file')
        }

        const arrayBuffer = await downloadResponse.arrayBuffer()
        fileBuffer = Buffer.from(arrayBuffer)
      }

      const resolvedName = params?.fileName || metadata.name || 'download'

      logger.info('File downloaded successfully', {
        fileId,
        name: resolvedName,
        size: fileBuffer.length,
        mimeType: finalMimeType,
      })

      return {
        success: true,
        output: {
          file: {
            name: resolvedName,
            mimeType: finalMimeType,
            data: fileBuffer,
            size: fileBuffer.length,
          },
        },
      }
    } catch (error: any) {
      logger.error('Error in transform response', {
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
