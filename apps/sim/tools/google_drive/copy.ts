import type { GoogleDriveFile, GoogleDriveToolParams } from '@/tools/google_drive/types'
import { ALL_FILE_FIELDS } from '@/tools/google_drive/utils'
import type { ToolConfig, ToolResponse } from '@/tools/types'

interface GoogleDriveCopyParams extends GoogleDriveToolParams {
  fileId: string
  newName?: string
  destinationFolderId?: string
}

interface GoogleDriveCopyResponse extends ToolResponse {
  output: {
    file: GoogleDriveFile
  }
}

export const copyTool: ToolConfig<GoogleDriveCopyParams, GoogleDriveCopyResponse> = {
  id: 'google_drive_copy',
  name: 'Copy Google Drive File',
  description: 'Create a copy of a file in Google Drive',
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
      description: 'The ID of the file to copy',
    },
    newName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Name for the copied file (defaults to "Copy of [original name]")',
    },
    destinationFolderId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ID of the folder to place the copy in (defaults to same location as original)',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(`https://www.googleapis.com/drive/v3/files/${params.fileId?.trim()}/copy`)
      url.searchParams.append('fields', ALL_FILE_FIELDS)
      url.searchParams.append('supportsAllDrives', 'true')
      return url.toString()
    },
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {}
      if (params.newName) {
        body.name = params.newName
      }
      if (params.destinationFolderId) {
        body.parents = [params.destinationFolderId.trim()]
      }
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error?.message || 'Failed to copy Google Drive file')
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
      description: 'The copied file metadata',
      properties: {
        id: { type: 'string', description: 'Google Drive file ID of the copy' },
        kind: { type: 'string', description: 'Resource type identifier' },
        name: { type: 'string', description: 'File name' },
        mimeType: { type: 'string', description: 'MIME type' },
        webViewLink: { type: 'string', description: 'URL to view in browser' },
        parents: { type: 'json', description: 'Parent folder IDs' },
        createdTime: { type: 'string', description: 'File creation time' },
        modifiedTime: { type: 'string', description: 'Last modification time' },
        owners: { type: 'json', description: 'List of file owners' },
        size: { type: 'string', description: 'File size in bytes' },
      },
    },
  },
}
