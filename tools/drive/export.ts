import { ToolConfig } from '../types'
import { GoogleDriveDownloadResponse } from './types'
import { GoogleDriveToolParams } from './types'

export const exportTool: ToolConfig<
  GoogleDriveToolParams & { mimeType?: string },
  GoogleDriveDownloadResponse
> = {
  id: 'google_drive_export',
  name: 'Export from Google Drive',
  description: 'Export a Google Workspace file (Docs, Sheets, Slides) from Google Drive',
  version: '1.0',
  oauth: {
    required: true,
    provider: 'google-drive',
    additionalScopes: ['https://www.googleapis.com/auth/drive'],
  },
  params: {
    accessToken: { type: 'string', required: true },
    fileId: { type: 'string', required: true },
    mimeType: { type: 'string', required: false },
  },
  request: {
    url: (params) => {
      const exportMimeType = params.mimeType || 'application/pdf'
      return `https://www.googleapis.com/drive/v3/files/${params.fileId}/export?mimeType=${encodeURIComponent(exportMimeType)}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },
  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const error = await response.json()
      console.error('Google Drive export error:', {
        status: response.status,
        statusText: response.statusText,
        error,
        fileId: response.url.split('files/')[1]?.split('?')[0],
      })
      throw new Error(
        `Failed to export file from Google Drive: ${response.status} ${response.statusText} - ${error.error?.message || 'Unknown error'}`
      )
    }

    // Get file metadata
    const fileId = response.url.split('files/')[1]?.split('?')[0]
    const metadataResponse = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
      headers: {
        Authorization: response.headers.get('Authorization') || '',
      },
    })

    if (!metadataResponse.ok) {
      const metadataError = await metadataResponse.json()
      console.error('Google Drive metadata error:', {
        status: metadataResponse.status,
        statusText: metadataResponse.statusText,
        error: metadataError,
      })
      throw new Error(
        `Failed to get file metadata: ${metadataResponse.status} ${metadataResponse.statusText} - ${metadataError.error?.message || 'Unknown error'}`
      )
    }

    const metadata = await metadataResponse.json()
    let content
    try {
      content = await response.text()
    } catch (error: any) {
      console.error('Error reading response content:', {
        message: error.message,
        stack: error.stack,
        error: JSON.stringify(error),
      })
      throw new Error(`Failed to read file content: ${error?.message || 'Unknown error'}`)
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
  },
  transformError: (error: any) => {
    console.error('Export tool error:', {
      message: error.message,
      stack: error.stack,
      error: JSON.stringify(error, null, 2),
    })
    if (typeof error === 'string') {
      return error
    }
    return (
      error.message ||
      JSON.stringify(error, null, 2) ||
      'An error occurred while exporting from Google Drive'
    )
  },
}
