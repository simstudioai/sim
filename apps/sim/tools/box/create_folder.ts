import type { BoxCreateFolderParams, BoxCreateFolderResponse } from '@/tools/box/types'
import type { ToolConfig } from '@/tools/types'

export const boxCreateFolderTool: ToolConfig<BoxCreateFolderParams, BoxCreateFolderResponse> = {
  id: 'box_create_folder',
  name: 'Box Create Folder',
  description: 'Create a new folder in Box',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'box',
  },

  params: {
    parentFolderId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the parent folder (use "0" for root folder)',
    },
    folderName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The name of the new folder',
    },
  },

  request: {
    url: 'https://api.box.com/2.0/folders',
    method: 'POST',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Missing access token for Box API request')
      }
      return {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      }
    },
    body: (params) => ({
      name: params.folderName,
      parent: {
        id: params.parentFolderId,
      },
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: data.message || data.error_description || 'Failed to create folder',
        output: {},
      }
    }

    return {
      success: true,
      output: {
        folder: data,
      },
    }
  },

  outputs: {
    folder: {
      type: 'object',
      description: 'The created folder',
      properties: {
        id: { type: 'string', description: 'Folder ID' },
        name: { type: 'string', description: 'Folder name' },
        created_at: { type: 'string', description: 'Creation timestamp' },
        parent: { type: 'object', description: 'Parent folder' },
      },
    },
  },
}
