import type { ToolConfig } from '../types'
import type { GoogleDriveListResponse, GoogleDriveToolParams } from './types'

export const listTool: ToolConfig<GoogleDriveToolParams, GoogleDriveListResponse> = {
  id: 'google_drive_list',
  name: 'List Google Drive Files',
  description: 'List files and folders in Google Drive',
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
    folderSelector: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Select the folder to list files from',
    },
    folderId: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'The ID of the folder to list files from (internal use)',
    },
    query: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'A query to filter the files',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'The number of files to return',
    },
    pageToken: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'The page token to use for pagination',
    },
  },
  request: {
    url: (params) => {
      const url = new URL('https://www.googleapis.com/drive/v3/files')
      url.searchParams.append(
        'fields',
        'files(id,name,mimeType,webViewLink,webContentLink,size,createdTime,modifiedTime,parents),nextPageToken'
      )

      // Build the query conditions
      const conditions = ['trashed = false'] // Always exclude trashed files
      const folderId = params.folderId || params.folderSelector
      if (folderId) {
        conditions.push(`'${folderId}' in parents`)
      }

      // Combine all conditions with AND
      url.searchParams.append('q', conditions.join(' and '))

      if (params.query) {
        const existingQ = url.searchParams.get('q')
        const queryPart = `name contains '${params.query}'`
        url.searchParams.set('q', `${existingQ} and ${queryPart}`)
      }
      if (params.pageSize) {
        url.searchParams.append('pageSize', params.pageSize.toString())
      }
      if (params.pageToken) {
        url.searchParams.append('pageToken', params.pageToken)
      }

      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },
  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error?.message || 'Failed to list Google Drive files')
    }

    return {
      success: true,
      output: {
        files: data.files.map((file: any) => ({
          id: file.id,
          name: file.name,
          mimeType: file.mimeType,
          webViewLink: file.webViewLink,
          webContentLink: file.webContentLink,
          size: file.size,
          createdTime: file.createdTime,
          modifiedTime: file.modifiedTime,
          parents: file.parents,
        })),
        nextPageToken: data.nextPageToken,
      },
    }
  },
  transformError: (error) => {
    return error.message || 'An error occurred while listing Google Drive files'
  },
}
