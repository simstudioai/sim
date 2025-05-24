import { ToolConfig } from '../types'
import { GoogleDriveToolParams, GoogleDriveUploadResponse } from './types'

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
      description: 'The access token for the Google Drive API',
    },
    fileName: { type: 'string', required: true, description: 'The name of the file to upload' },
    content: { type: 'string', required: true, description: 'The content of the file to upload' },
    mimeType: {
      type: 'string',
      required: false,
      description: 'The MIME type of the file to upload',
    },
    folderId: {
      type: 'string',
      required: false,
      description: 'The ID of the folder to upload the file to',
    },
  },
  request: {
    url: 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'multipart/related; boundary=boundary',
    }),
    body: (params) => {
      const metadata = {
        name: params.fileName,
        ...(params.folderId ? { parents: [params.folderId] } : {}),
      }

      const mimeType = params.mimeType || 'text/plain'

      const body = `--boundary
Content-Type: application/json; charset=UTF-8

${JSON.stringify(metadata)}

--boundary
Content-Type: ${mimeType}

${params.content}
--boundary--`

      return { body }
    },
  },
  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error?.message || 'Failed to upload file to Google Drive')
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
    return error.message || 'An error occurred while uploading to Google Drive'
  },
}
