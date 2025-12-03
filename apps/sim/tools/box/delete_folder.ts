import type { BoxDeleteFolderParams, BoxDeleteFolderResponse } from '@/tools/box/types'
import type { ToolConfig } from '@/tools/types'

export const boxDeleteFolderTool: ToolConfig<BoxDeleteFolderParams, BoxDeleteFolderResponse> = {
  id: 'box_delete_folder',
  name: 'Box Delete Folder',
  description: 'Delete a folder from Box (moves to trash by default)',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'box',
  },

  params: {
    folderId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the folder to delete',
    },
    recursive: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Delete folder contents recursively (default: true)',
    },
  },

  request: {
    url: (params) => {
      const recursive = params.recursive !== false ? 'true' : 'false'
      return `https://api.box.com/2.0/folders/${params.folderId}?recursive=${recursive}`
    },
    method: 'DELETE',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Missing access token for Box API request')
      }
      return {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      }
    },
  },

  transformResponse: async (response, params) => {
    if (response.status === 204) {
      return {
        success: true,
        output: {
          success: true,
          folderId: params?.folderId,
        },
      }
    }

    const data = await response.json().catch(() => ({}))
    return {
      success: false,
      error: data.message || data.error_description || 'Failed to delete folder',
      output: {},
    }
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Whether the folder was successfully deleted',
    },
    folderId: {
      type: 'string',
      description: 'The ID of the deleted folder',
    },
  },
}
