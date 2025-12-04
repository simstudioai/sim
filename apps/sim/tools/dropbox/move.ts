import type { DropboxMoveParams, DropboxMoveResponse } from '@/tools/dropbox/types'
import type { ToolConfig } from '@/tools/types'

export const dropboxMoveTool: ToolConfig<DropboxMoveParams, DropboxMoveResponse> = {
  id: 'dropbox_move',
  name: 'Dropbox Move',
  description: 'Move or rename a file or folder in Dropbox',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'dropbox',
  },

  params: {
    fromPath: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The source path of the file or folder to move',
    },
    toPath: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The destination path for the moved file or folder',
    },
    autorename: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'If true, rename the file if there is a conflict at destination',
    },
  },

  request: {
    url: 'https://api.dropboxapi.com/2/files/move_v2',
    method: 'POST',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Missing access token for Dropbox API request')
      }
      return {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      }
    },
    body: (params) => ({
      from_path: params.fromPath,
      to_path: params.toPath,
      autorename: params.autorename ?? false,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: data.error_summary || data.error?.message || 'Failed to move file/folder',
        output: {},
      }
    }

    return {
      success: true,
      output: {
        metadata: data.metadata,
      },
    }
  },

  outputs: {
    metadata: {
      type: 'object',
      description: 'Metadata of the moved item',
      properties: {
        '.tag': { type: 'string', description: 'Type: file or folder' },
        id: { type: 'string', description: 'Unique identifier' },
        name: { type: 'string', description: 'Name of the moved item' },
        path_display: { type: 'string', description: 'Display path' },
        size: { type: 'number', description: 'Size in bytes (files only)' },
      },
    },
  },
}
