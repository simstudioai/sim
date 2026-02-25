import type { GoogleDriveFile, GoogleDriveToolParams } from '@/tools/google_drive/types'
import { ALL_FILE_FIELDS } from '@/tools/google_drive/utils'
import type { ToolConfig, ToolResponse } from '@/tools/types'

interface GoogleDriveMoveParams extends GoogleDriveToolParams {
  fileId: string
  destinationFolderId: string
  removeFromCurrent?: boolean
}

interface GoogleDriveMoveResponse extends ToolResponse {
  output: {
    file: GoogleDriveFile
  }
}

export const moveTool: ToolConfig<GoogleDriveMoveParams, GoogleDriveMoveResponse> = {
  id: 'google_drive_move',
  name: 'Move Google Drive File',
  description: 'Move a file or folder to a different folder in Google Drive',
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
      description: 'The ID of the file or folder to move',
    },
    destinationFolderId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the destination folder',
    },
    removeFromCurrent: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Whether to remove the file from its current parent folder (default: true). Set to false to add the file to the destination without removing it from the current location.',
    },
  },

  request: {
    url: 'https://www.googleapis.com/drive/v3/files',
    method: 'PATCH',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
  },

  directExecution: async (params) => {
    const fileId = params.fileId?.trim()
    const destinationFolderId = params.destinationFolderId?.trim()
    const removeFromCurrent = params.removeFromCurrent !== false

    if (!fileId) {
      throw new Error('fileId is required')
    }
    if (!destinationFolderId) {
      throw new Error('destinationFolderId is required')
    }

    const headers = {
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }

    // Build the PATCH URL with addParents
    const url = new URL(`https://www.googleapis.com/drive/v3/files/${fileId}`)
    url.searchParams.append('addParents', destinationFolderId)
    url.searchParams.append('fields', ALL_FILE_FIELDS)
    url.searchParams.append('supportsAllDrives', 'true')

    if (removeFromCurrent) {
      // Fetch current parents so we can remove them
      const metadataUrl = new URL(`https://www.googleapis.com/drive/v3/files/${fileId}`)
      metadataUrl.searchParams.append('fields', 'parents')
      metadataUrl.searchParams.append('supportsAllDrives', 'true')

      const metadataResponse = await fetch(metadataUrl.toString(), { headers })

      if (!metadataResponse.ok) {
        const errorData = await metadataResponse.json()
        throw new Error(errorData.error?.message || 'Failed to retrieve file metadata')
      }

      const metadata = await metadataResponse.json()
      if (metadata.parents && metadata.parents.length > 0) {
        url.searchParams.append('removeParents', metadata.parents.join(','))
      }
    }

    const response = await fetch(url.toString(), {
      method: 'PATCH',
      headers,
      body: JSON.stringify({}),
    })

    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error?.message || 'Failed to move Google Drive file')
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
      description: 'The moved file metadata',
      properties: {
        id: { type: 'string', description: 'Google Drive file ID' },
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
