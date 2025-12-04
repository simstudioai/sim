import type { DropboxCreateFolderParams, DropboxCreateFolderResponse } from '@/tools/dropbox/types'
import type { ToolConfig } from '@/tools/types'

export const dropboxCreateFolderTool: ToolConfig<
  DropboxCreateFolderParams,
  DropboxCreateFolderResponse
> = {
  id: 'dropbox_create_folder',
  name: 'Dropbox Create Folder',
  description: 'Create a new folder in Dropbox',
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
      description: 'The path where the folder should be created (e.g., /new-folder)',
    },
    autorename: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'If true, rename the folder if there is a conflict',
    },
  },

  request: {
    url: 'https://api.dropboxapi.com/2/files/create_folder_v2',
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
      autorename: params.autorename ?? false,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: data.error_summary || data.error?.message || 'Failed to create folder',
        output: {},
      }
    }

    return {
      success: true,
      output: {
        folder: data.metadata,
      },
    }
  },

  outputs: {
    folder: {
      type: 'object',
      description: 'The created folder metadata',
      properties: {
        id: { type: 'string', description: 'Unique identifier for the folder' },
        name: { type: 'string', description: 'Name of the folder' },
        path_display: { type: 'string', description: 'Display path of the folder' },
        path_lower: { type: 'string', description: 'Lowercase path of the folder' },
      },
    },
  },
}
