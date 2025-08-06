import { createLogger } from '@/lib/logs/console/logger'
import type { OneDriveToolParams, OneDriveUploadResponse } from '@/tools/onedrive/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('OneDriveUploadTool')

export const uploadTool: ToolConfig<OneDriveToolParams, OneDriveUploadResponse> = {
  id: 'onedrive_upload',
  name: 'Upload to OneDrive',
  description: 'Upload a file to OneDrive',
  version: '1.0',
  oauth: {
    required: true,
    provider: 'onedrive',
    additionalScopes: [
      'openid',
      'profile',
      'email',
      'Files.Read',
      'Files.ReadWrite',
      'offline_access',
    ],
  },
  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'The access token for the OneDrive API',
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
    url: (params) => {
      let fileName = params.fileName || 'untitled'

      // Always create .txt files for text content
      if (!fileName.endsWith('.txt')) {
        // Remove any existing extensions and add .txt
        fileName = `${fileName.replace(/\.[^.]*$/, '')}.txt`
      }

      // Build the proper URL based on parent folder
      const parentFolderId = params.folderSelector || params.folderId
      if (parentFolderId && parentFolderId.trim() !== '') {
        return `https://graph.microsoft.com/v1.0/me/drive/items/${parentFolderId}:/${fileName}:/content`
      }
      // Default to root folder
      return `https://graph.microsoft.com/v1.0/me/drive/root:/${fileName}:/content`
    },
    method: 'PUT',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'text/plain',
    }),
    body: (params) => (params.content || '') as unknown as Record<string, unknown>,
  },
  transformResponse: async (response: Response, params?: OneDriveToolParams) => {
    try {
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        logger.error('Failed to upload file to OneDrive', {
          status: response.status,
          statusText: response.statusText,
          errorData,
        })
        throw new Error(errorData.error?.message || 'Failed to upload file to OneDrive')
      }

      // Microsoft Graph API returns the file metadata directly
      const fileData = await response.json()

      logger.info('Successfully uploaded file to OneDrive', {
        fileId: fileData.id,
        fileName: fileData.name,
      })

      return {
        success: true,
        output: {
          file: {
            id: fileData.id,
            name: fileData.name,
            mimeType: fileData.file?.mimeType || params?.mimeType || 'text/plain',
            webViewLink: fileData.webUrl,
            webContentLink: fileData['@microsoft.graph.downloadUrl'],
            size: fileData.size,
            createdTime: fileData.createdDateTime,
            modifiedTime: fileData.lastModifiedDateTime,
            parentReference: fileData.parentReference,
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
    return error.message || 'An error occurred while uploading to OneDrive'
  },
}
