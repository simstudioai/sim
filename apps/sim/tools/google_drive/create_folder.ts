import type { ToolConfig } from '../types'
import type { GoogleDriveToolParams, GoogleDriveUploadResponse } from './types'

export const createFolderTool: ToolConfig<GoogleDriveToolParams, GoogleDriveUploadResponse> = {
  id: 'google_drive_create_folder',
  name: 'Create Folder in Google Drive',
  description: 'Create a new folder in Google Drive',
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
      description: 'Name of the folder to create',
    },
    folderSelector: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Select the parent folder to create the folder in',
    },
    folderId: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'ID of the parent folder (internal use)',
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
        name: params.fileName,
        mimeType: 'application/vnd.google-apps.folder',
      }

      // Add parent folder if specified (prefer folderSelector over folderId)
      const parentFolderId = params.folderSelector || params.folderId
      if (parentFolderId) {
        metadata.parents = [parentFolderId]
      }

      return metadata
    },
  },
  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      throw new Error(data.error?.message || 'Failed to create folder in Google Drive')
    }
    const data = await response.json()

    return {
      success: true,
      output: {
        file: {
          id: data.id,
          name: data.name,
          mimeType: data.mimeType,
          webViewLink: data.webViewLink,
          webContentLink: data.webContentLink,
          size: data.size,
          createdTime: data.createdTime,
          modifiedTime: data.modifiedTime,
          parents: data.parents,
        },
      },
    }
  },
  transformError: (error) => {
    return error.message || 'An error occurred while creating folder in Google Drive'
  },
}
