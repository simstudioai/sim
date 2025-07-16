import { createLogger } from '@/lib/logs/console-logger'
import type { ToolConfig } from '../types'
import type { GoogleDriveToolParams, GoogleDriveUploadResponse } from './types'
import { GOOGLE_WORKSPACE_MIME_TYPES, SOURCE_MIME_TYPES } from './utils'

const logger = createLogger('GoogleDriveUploadTool')

export const uploadTool: ToolConfig<GoogleDriveToolParams, GoogleDriveUploadResponse> = {
  id: 'google_drive_upload',
  name: 'Upload to Google Drive',
  description: 'Upload a file to Google Drive',
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
    fileName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The name of the file to upload',
    },
    content: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The content of the file to upload',
    },
    mimeType: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'The MIME type of the file to upload',
    },
    folderSelector: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Select the folder to upload the file to',
    },
    folderId: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'The ID of the folder to upload the file to (internal use)',
    },
  },
  request: {
    url: 'https://www.googleapis.com/drive/v3/files',
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const metadata: {
        name: string | undefined
        mimeType: string
        parents?: string[]
      } = {
        name: params.fileName, // Important: Always include the filename in metadata
        mimeType: params.mimeType || 'text/plain',
      }

      // Add parent folder if specified (prefer folderSelector over folderId)
      const parentFolderId = params.folderSelector || params.folderId
      if (parentFolderId && parentFolderId.trim() !== '') {
        metadata.parents = [parentFolderId]
      }

      return metadata
    },
  },
  transformResponse: async (response: Response, params?: GoogleDriveToolParams) => {
    try {
      const data = await response.json()

      if (!response.ok) {
        logger.error('Failed to create file in Google Drive', {
          status: response.status,
          statusText: response.statusText,
          data,
        })
        throw new Error(data.error?.message || 'Failed to create file in Google Drive')
      }

      // Now upload content to the created file
      const fileId = data.id
      const requestedMimeType = params?.mimeType || 'text/plain'
      const authHeader =
        response.headers.get('Authorization') || `Bearer ${params?.accessToken || ''}`

      // For Google Workspace formats, use the appropriate source MIME type for content upload
      const uploadMimeType = GOOGLE_WORKSPACE_MIME_TYPES.includes(requestedMimeType)
        ? SOURCE_MIME_TYPES[requestedMimeType] || 'text/plain'
        : requestedMimeType

      logger.info('Uploading content to file', {
        fileId,
        fileName: params?.fileName,
        requestedMimeType,
        uploadMimeType,
      })

      const uploadResponse = await fetch(
        `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`,
        {
          method: 'PATCH',
          headers: {
            Authorization: authHeader,
            'Content-Type': uploadMimeType,
          },
          body: params?.content || '',
        }
      )

      if (!uploadResponse.ok) {
        const uploadError = await uploadResponse.json()
        logger.error('Failed to upload content to file', {
          status: uploadResponse.status,
          statusText: uploadResponse.statusText,
          error: uploadError,
        })
        throw new Error(uploadError.error?.message || 'Failed to upload content to file')
      }

      // For Google Workspace documents, update the name again to ensure it sticks after conversion
      if (GOOGLE_WORKSPACE_MIME_TYPES.includes(requestedMimeType)) {
        logger.info('Updating file name to ensure it persists after conversion', {
          fileId,
          fileName: params?.fileName,
        })

        const updateNameResponse = await fetch(
          `https://www.googleapis.com/drive/v3/files/${fileId}`,
          {
            method: 'PATCH',
            headers: {
              Authorization: authHeader,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              name: params?.fileName,
            }),
          }
        )

        if (!updateNameResponse.ok) {
          logger.warn('Failed to update filename after conversion, but content was uploaded', {
            status: updateNameResponse.status,
            statusText: updateNameResponse.statusText,
          })
        }
      }

      // Get the final file data
      const finalFileResponse = await fetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,mimeType,webViewLink,webContentLink,size,createdTime,modifiedTime,parents`,
        {
          headers: {
            Authorization: authHeader,
          },
        }
      )

      const finalFile = await finalFileResponse.json()

      return {
        success: true,
        output: {
          file: {
            id: finalFile.id,
            name: finalFile.name,
            mimeType: finalFile.mimeType,
            webViewLink: finalFile.webViewLink,
            webContentLink: finalFile.webContentLink,
            size: finalFile.size,
            createdTime: finalFile.createdTime,
            modifiedTime: finalFile.modifiedTime,
            parents: finalFile.parents,
          },
        },
      }
    } catch (error: any) {
      logger.error('Error in upload transformation', {
        error: error.message,
        stack: error.stack,
      })
      throw error
    }
  },
  transformError: (error) => {
    logger.error('Upload error', {
      error: error.message,
      stack: error.stack,
    })
    return error.message || 'An error occurred while uploading to Google Drive'
  },
}
