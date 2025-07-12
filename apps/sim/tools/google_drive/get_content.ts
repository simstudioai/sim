import { createLogger } from '@/lib/logs/console-logger'
import type { ToolConfig } from '../types'
import type { GoogleDriveGetContentResponse, GoogleDriveToolParams } from './types'
import { DEFAULT_EXPORT_FORMATS, GOOGLE_WORKSPACE_MIME_TYPES } from './utils'

const logger = createLogger('GoogleDriveGetContentTool')

export const getContentTool: ToolConfig<GoogleDriveToolParams, GoogleDriveGetContentResponse> = {
  id: 'google_drive_get_content',
  name: 'Get Content from Google Drive',
  description:
    'Get content from a file in Google Drive (exports Google Workspace files automatically)',
  version: '1.0',
  oauth: {
    required: true,
    provider: 'google-drive',
    additionalScopes: ['https://www.googleapis.com/auth/drive.file'],
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
      description: 'The ID of the file to get content from',
    },
    mimeType: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'The MIME type to export Google Workspace files to (optional)',
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

      let content: string

      if (GOOGLE_WORKSPACE_MIME_TYPES.includes(mimeType)) {
        const exportFormat = params?.mimeType || DEFAULT_EXPORT_FORMATS[mimeType] || 'text/plain'
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

        content = await exportResponse.text()
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

        content = await downloadResponse.text()
      }

      const metadataResponse = await fetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,mimeType,webViewLink,webContentLink,size,createdTime,modifiedTime,parents`,
        {
          headers: {
            Authorization: authHeader,
          },
        }
      )

      if (!metadataResponse.ok) {
        logger.warn('Failed to get full metadata, using partial metadata', {
          status: metadataResponse.status,
          statusText: metadataResponse.statusText,
        })
      } else {
        const fullMetadata = await metadataResponse.json()
        Object.assign(metadata, fullMetadata)
      }

      return {
        success: true,
        output: {
          content,
          metadata: {
            id: metadata.id,
            name: metadata.name,
            mimeType: metadata.mimeType,
            webViewLink: metadata.webViewLink,
            webContentLink: metadata.webContentLink,
            size: metadata.size,
            createdTime: metadata.createdTime,
            modifiedTime: metadata.modifiedTime,
            parents: metadata.parents,
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
  transformError: (error) => {
    logger.error('Download error', {
      message: error.message,
      stack: error.stack,
    })
    return error.message || 'An error occurred while getting content from Google Drive'
  },
}
