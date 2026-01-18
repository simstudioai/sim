import type { GoogleDriveFile, GoogleDriveToolParams } from '@/tools/google_drive/types'
import { ALL_FILE_FIELDS } from '@/tools/google_drive/utils'
import type { ToolConfig, ToolResponse } from '@/tools/types'

interface GoogleDriveTrashParams extends GoogleDriveToolParams {
  fileId: string
}

interface GoogleDriveTrashResponse extends ToolResponse {
  output: {
    file: GoogleDriveFile
  }
}

export const trashTool: ToolConfig<GoogleDriveTrashParams, GoogleDriveTrashResponse> = {
  id: 'google_drive_trash',
  name: 'Trash Google Drive File',
  description: 'Move a file to the trash in Google Drive (can be restored later)',
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
      description: 'The ID of the file to move to trash',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(`https://www.googleapis.com/drive/v3/files/${params.fileId?.trim()}`)
      url.searchParams.append('fields', ALL_FILE_FIELDS)
      url.searchParams.append('supportsAllDrives', 'true')
      return url.toString()
    },
    method: 'PATCH',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: () => ({
      trashed: true,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error?.message || 'Failed to trash Google Drive file')
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
      description: 'The trashed file metadata',
      properties: {
        id: { type: 'string', description: 'Google Drive file ID' },
        kind: { type: 'string', description: 'Resource type identifier' },
        name: { type: 'string', description: 'File name' },
        mimeType: { type: 'string', description: 'MIME type' },
        trashed: { type: 'boolean', description: 'Whether file is in trash (should be true)' },
        trashedTime: { type: 'string', description: 'When file was trashed' },
        webViewLink: { type: 'string', description: 'URL to view in browser' },
      },
    },
  },
}
