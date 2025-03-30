import { ToolConfig } from '../types'
import { GoogleDriveDownloadResponse, GoogleDriveToolParams } from './types'

export const downloadTool: ToolConfig<GoogleDriveToolParams, GoogleDriveDownloadResponse> = {
  id: 'google_drive_download',
  name: 'Download from Google Drive',
  description: 'Download a file from Google Drive',
  version: '1.0',
  oauth: {
    required: true,
    provider: 'google-drive',
    additionalScopes: ['https://www.googleapis.com/auth/drive.file'],
  },
  params: {
    accessToken: { type: 'string', required: true },
    fileId: { type: 'string', required: true },
  },
  request: {
    url: (params) => `https://www.googleapis.com/drive/v3/files/${params.fileId}?alt=media`,
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },
  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error?.message || 'Failed to download file from Google Drive')
    }

    // Get file metadata
    const metadataResponse = await fetch(
      `https://www.googleapis.com/drive/v3/files/${response.url.split('files/')[1].split('?')[0]}`,
      {
        headers: {
          Authorization: response.headers.get('Authorization') || '',
        },
      }
    )

    const metadata = await metadataResponse.json()
    const content = await response.text()

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
  },
  transformError: (error) => {
    return error.message || 'An error occurred while downloading from Google Drive'
  },
}
