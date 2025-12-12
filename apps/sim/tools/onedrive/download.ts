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
    url: (params) => {
      return `https://graph.microsoft.com/v1.0/me/drive/items/${params.fileId}`
    },
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
          requestedFileId: params?.fileId,
        })
        throw new Error(errorDetails.error?.message || 'Failed to get file metadata')
      }

      const metadata = await response.json()

      // Check if this is actually a folder
      if (metadata.folder && !metadata.file) {
        logger.error('Attempted to download a folder instead of a file', {
          itemId: metadata.id,
          itemName: metadata.name,
          isFolder: true,
        })
        throw new Error(`Cannot download folder "${metadata.name}". Please select a file instead.`)
      }

      const fileId = metadata.id
      const fileName = metadata.name
      const mimeType = metadata.file?.mimeType || 'application/octet-stream'
      const authHeader = `Bearer ${params?.accessToken || ''}`

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

      // Convert buffer to base64 string for proper JSON serialization
      // This ensures the file data survives the proxy round-trip
      const base64Data = fileBuffer.toString('base64')

      return {
        success: true,
        output: {
          file: {
            name: resolvedName,
            mimeType,
            data: base64Data,
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
