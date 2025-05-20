import { ToolConfig } from '../types'
import { GoogleDriveToolParams, GoogleDriveUploadResponse } from './types'

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
      description: 'The access token for the Google Drive API',
    },
    fileName: {
      type: 'string',
      required: true,
      description: 'Name of the folder to create',
    },
    folderId: {
      type: 'string',
      required: false,
      description: 'ID of the parent folder (leave empty for root folder)',
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
      const metadata = {
        name: params.fileName,
        mimeType: 'application/vnd.google-apps.folder',
        ...(params.folderId ? { parents: [params.folderId] } : {}),
      }

      return { body: JSON.stringify(metadata) }
    },
  },
  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error?.message || 'Failed to create folder in Google Drive')
    }

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
