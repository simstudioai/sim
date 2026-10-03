import type { GoogleDriveFile, GoogleDriveToolParams } from '@/tools/google_drive/types'
import type { InternalToolConfig, ToolResponse } from '@/tools/types'

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

export const moveTool: InternalToolConfig<GoogleDriveMoveParams, GoogleDriveMoveResponse> = {
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

  operation: {
    input: (params) => ({
      accessToken: params.accessToken,
      fileId: params.fileId,
      destinationFolderId: params.destinationFolderId,
      removeFromCurrent: params.removeFromCurrent,
    }),
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
