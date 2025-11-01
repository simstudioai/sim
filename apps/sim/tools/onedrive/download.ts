import { createLogger } from '@/lib/logs/console/logger'
import type { OneDriveDownloadResponse, OneDriveToolParams } from '@/tools/onedrive/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('OneDriveDownloadTool')

export const downloadTool: ToolConfig<OneDriveToolParams, OneDriveDownloadResponse> = {
  id: 'onedrive_download',
  name: 'Download File from OneDrive',
  description: 'Download a file from OneDrive',
  version: '1.0',

  oauth: {
    required: true,
    provider: 'onedrive',
    additionalScopes: ['Files.Read', 'Files.ReadWrite', 'offline_access'],
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'The access token for the Microsoft Graph API',
    },
    fileId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The ID of the file to download',
    },
    fileName: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Optional filename override',
    },
  },

  request: {
    url: (params) => `https://graph.microsoft.com/v1.0/me/drive/items/${params.fileId}`,
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response: Response, params?: OneDriveToolParams) => {
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
      const fileName = metadata.name
      const mimeType = metadata.file?.mimeType || 'application/octet-stream'
      const authHeader = `Bearer ${params?.accessToken || ''}`

      logger.info('Downloading file from OneDrive', {
        fileId,
        fileName,
        mimeType,
      })

      const downloadResponse = await fetch(
        `https://graph.microsoft.com/v1.0/me/drive/items/${fileId}/content`,
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
      const fileBuffer = Buffer.from(arrayBuffer)

      const resolvedName = params?.fileName || fileName || 'download'

      logger.info('File downloaded successfully', {
        fileId,
        name: resolvedName,
        size: fileBuffer.length,
        mimeType,
      })

      return {
        success: true,
        output: {
          file: {
            name: resolvedName,
            mimeType,
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
