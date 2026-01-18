import type { GoogleDriveFile, GoogleDriveToolParams } from '@/tools/google_drive/types'
import { ALL_FILE_FIELDS } from '@/tools/google_drive/utils'
import type { ToolConfig, ToolResponse } from '@/tools/types'

interface GoogleDriveUpdateParams extends GoogleDriveToolParams {
  fileId: string
  name?: string
  description?: string
  addParents?: string
  removeParents?: string
  starred?: boolean
}

interface GoogleDriveUpdateResponse extends ToolResponse {
  output: {
    file: GoogleDriveFile
  }
}

export const updateTool: ToolConfig<GoogleDriveUpdateParams, GoogleDriveUpdateResponse> = {
  id: 'google_drive_update',
  name: 'Update Google Drive File',
  description: 'Update file metadata in Google Drive (rename, move, star, add description)',
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
      description: 'The ID of the file to update',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New name for the file',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New description for the file',
    },
    addParents: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of parent folder IDs to add (moves file to these folders)',
    },
    removeParents: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of parent folder IDs to remove',
    },
    starred: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to star or unstar the file',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(`https://www.googleapis.com/drive/v3/files/${params.fileId?.trim()}`)
      url.searchParams.append('fields', ALL_FILE_FIELDS)
      url.searchParams.append('supportsAllDrives', 'true')
      if (params.addParents) {
        url.searchParams.append('addParents', params.addParents.trim())
      }
      if (params.removeParents) {
        url.searchParams.append('removeParents', params.removeParents.trim())
      }
      return url.toString()
    },
    method: 'PATCH',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {}
      if (params.name !== undefined) {
        body.name = params.name
      }
      if (params.description !== undefined) {
        body.description = params.description
      }
      if (params.starred !== undefined) {
        body.starred = params.starred
      }
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error?.message || 'Failed to update Google Drive file')
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
      description: 'The updated file metadata',
      properties: {
        id: { type: 'string', description: 'Google Drive file ID' },
        kind: { type: 'string', description: 'Resource type identifier' },
        name: { type: 'string', description: 'File name' },
        mimeType: { type: 'string', description: 'MIME type' },
        description: { type: 'string', description: 'File description', optional: true },
        starred: { type: 'boolean', description: 'Whether file is starred' },
        webViewLink: { type: 'string', description: 'URL to view in browser' },
        parents: { type: 'json', description: 'Parent folder IDs' },
        modifiedTime: { type: 'string', description: 'Last modification time' },
      },
    },
  },
}
