import type { GoogleDriveFile, GoogleDriveToolParams } from '@/tools/google_drive/types'
import { ALL_FILE_FIELDS } from '@/tools/google_drive/utils'
import type { ToolConfig, ToolResponse } from '@/tools/types'

interface GoogleDriveGetFileParams extends GoogleDriveToolParams {
  fileId: string
}

interface GoogleDriveGetFileResponse extends ToolResponse {
  output: {
    file: GoogleDriveFile
  }
}

export const getFileTool: ToolConfig<GoogleDriveGetFileParams, GoogleDriveGetFileResponse> = {
  id: 'google_drive_get_file',
  name: 'Get Google Drive File',
  description: 'Get metadata for a specific file in Google Drive by its ID',
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
    fileId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the file to retrieve',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(`https://www.googleapis.com/drive/v3/files/${params.fileId?.trim()}`)
      url.searchParams.append('fields', ALL_FILE_FIELDS)
      url.searchParams.append('supportsAllDrives', 'true')
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
      throw new Error(data.error?.message || 'Failed to get Google Drive file')
    }

    return {
      success: true,
      output: {
        file: data,
      },
    }
  },

  outputs: {
    file: {
      type: 'json',
      description: 'The file metadata',
      properties: {
        id: { type: 'string', description: 'Google Drive file ID' },
        kind: { type: 'string', description: 'Resource type identifier' },
        name: { type: 'string', description: 'File name' },
        mimeType: { type: 'string', description: 'MIME type' },
        description: { type: 'string', description: 'File description', optional: true },
        size: { type: 'string', description: 'File size in bytes', optional: true },
        starred: { type: 'boolean', description: 'Whether file is starred' },
        trashed: { type: 'boolean', description: 'Whether file is in trash' },
        webViewLink: { type: 'string', description: 'URL to view in browser' },
        webContentLink: { type: 'string', description: 'Direct download URL', optional: true },
        iconLink: { type: 'string', description: 'URL to file icon' },
        thumbnailLink: { type: 'string', description: 'URL to thumbnail', optional: true },
        parents: { type: 'json', description: 'Parent folder IDs' },
        owners: { type: 'json', description: 'List of file owners' },
        permissions: { type: 'json', description: 'File permissions', optional: true },
        createdTime: { type: 'string', description: 'File creation time' },
        modifiedTime: { type: 'string', description: 'Last modification time' },
        lastModifyingUser: { type: 'json', description: 'User who last modified the file' },
        shared: { type: 'boolean', description: 'Whether file is shared' },
        ownedByMe: { type: 'boolean', description: 'Whether owned by current user' },
        capabilities: { type: 'json', description: 'User capabilities on file' },
        md5Checksum: { type: 'string', description: 'MD5 hash', optional: true },
        version: { type: 'string', description: 'Version number' },
      },
    },
  },
}
