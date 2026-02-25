import type { GoogleDriveFile, GoogleDriveToolParams } from '@/tools/google_drive/types'
import { ALL_FILE_FIELDS } from '@/tools/google_drive/utils'
import type { ToolConfig, ToolResponse } from '@/tools/types'

interface GoogleDriveSearchParams extends GoogleDriveToolParams {
  query: string
  pageSize?: number
  pageToken?: string
}

interface GoogleDriveSearchResponse extends ToolResponse {
  output: {
    files: GoogleDriveFile[]
    nextPageToken?: string
  }
}

export const searchTool: ToolConfig<GoogleDriveSearchParams, GoogleDriveSearchResponse> = {
  id: 'google_drive_search',
  name: 'Search Google Drive Files',
  description:
    'Search for files in Google Drive using advanced query syntax (e.g., fullText contains, mimeType, modifiedTime, etc.)',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'google-drive',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token',
    },
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Google Drive query string using advanced search syntax (e.g., "fullText contains \'budget\'", "mimeType = \'application/pdf\'", "modifiedTime > \'2024-01-01\'")',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of files to return (default: 100)',
    },
    pageToken: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'Token for fetching the next page of results',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://www.googleapis.com/drive/v3/files')
      url.searchParams.append('fields', `files(${ALL_FILE_FIELDS}),nextPageToken`)
      url.searchParams.append('corpora', 'allDrives')
      url.searchParams.append('supportsAllDrives', 'true')
      url.searchParams.append('includeItemsFromAllDrives', 'true')

      // The query is passed directly as Google Drive query syntax
      const conditions = ['trashed = false']
      if (params.query?.trim()) {
        conditions.push(params.query.trim())
      }
      url.searchParams.append('q', conditions.join(' and '))

      if (params.pageSize) {
        url.searchParams.append('pageSize', Number(params.pageSize).toString())
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
      throw new Error(data.error?.message || 'Failed to search Google Drive files')
    }

    return {
      success: true,
      output: {
        files: data.files || [],
        nextPageToken: data.nextPageToken,
      },
    }
  },

  outputs: {
    files: {
      type: 'array',
      description: 'Array of file metadata objects matching the search query',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Google Drive file ID' },
          kind: { type: 'string', description: 'Resource type identifier' },
          name: { type: 'string', description: 'File name' },
          mimeType: { type: 'string', description: 'MIME type' },
          description: { type: 'string', description: 'File description' },
          originalFilename: { type: 'string', description: 'Original uploaded filename' },
          fullFileExtension: { type: 'string', description: 'Full file extension' },
          fileExtension: { type: 'string', description: 'File extension' },
          owners: { type: 'json', description: 'List of file owners' },
          permissions: { type: 'json', description: 'File permissions' },
          shared: { type: 'boolean', description: 'Whether file is shared' },
          ownedByMe: { type: 'boolean', description: 'Whether owned by current user' },
          starred: { type: 'boolean', description: 'Whether file is starred' },
          trashed: { type: 'boolean', description: 'Whether file is in trash' },
          createdTime: { type: 'string', description: 'File creation time' },
          modifiedTime: { type: 'string', description: 'Last modification time' },
          lastModifyingUser: { type: 'json', description: 'User who last modified the file' },
          webViewLink: { type: 'string', description: 'URL to view in browser' },
          webContentLink: { type: 'string', description: 'Direct download URL' },
          iconLink: { type: 'string', description: 'URL to file icon' },
          thumbnailLink: { type: 'string', description: 'URL to thumbnail' },
          size: { type: 'string', description: 'File size in bytes' },
          parents: { type: 'json', description: 'Parent folder IDs' },
          driveId: { type: 'string', description: 'Shared drive ID' },
          capabilities: { type: 'json', description: 'User capabilities on file' },
          version: { type: 'string', description: 'Version number' },
        },
      },
    },
    nextPageToken: {
      type: 'string',
      description: 'Token for fetching the next page of results',
    },
  },
}
