import type { DropboxDeleteParams, DropboxDeleteResponse } from '@/tools/dropbox/types'
import type { ToolConfig } from '@/tools/types'

export const dropboxDeleteTool: ToolConfig<DropboxDeleteParams, DropboxDeleteResponse> = {
  id: 'dropbox_delete',
  name: 'Dropbox Delete',
  description: 'Delete a file or folder in Dropbox (moves to trash)',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'dropbox',
  },

  params: {
    path: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The path of the file or folder to delete',
    },
  },

  request: {
    url: 'https://api.dropboxapi.com/2/files/delete_v2',
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
      path: params.path,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: data.error_summary || data.error?.message || 'Failed to delete file/folder',
        output: {},
      }
    }

    return {
      success: true,
      output: {
        metadata: data.metadata,
        deleted: true,
      },
    }
  },

  outputs: {
    metadata: {
      type: 'object',
      description: 'Metadata of the deleted item',
      properties: {
        '.tag': { type: 'string', description: 'Type: file, folder, or deleted' },
        name: { type: 'string', description: 'Name of the deleted item' },
        path_display: { type: 'string', description: 'Display path' },
      },
    },
    deleted: {
      type: 'boolean',
      description: 'Whether the deletion was successful',
    },
  },
}
