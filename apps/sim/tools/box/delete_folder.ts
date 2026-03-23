import type { ToolConfig, ToolResponse } from '@/tools/types'
import type { BoxDeleteFolderParams } from './types'

export const boxDeleteFolderTool: ToolConfig<BoxDeleteFolderParams, ToolResponse> = {
  id: 'box_delete_folder',
  name: 'Box Delete Folder',
  description: 'Delete a folder from Box',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'box',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token for Box API',
    },
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
      description: 'Delete folder and all its contents recursively',
    },
  },

  request: {
    url: (params) => {
      const queryParams = new URLSearchParams()
      if (params.recursive) queryParams.set('recursive', 'true')
      const qs = queryParams.toString()
      return `https://api.box.com/2.0/folders/${params.folderId.trim()}${qs ? `?${qs}` : ''}`
    },
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response) => {
    if (response.status === 204) {
      return {
        success: true,
        output: {
          deleted: true,
          message: 'Folder deleted successfully',
        },
      }
    }

    const data = await response.json()
    throw new Error(data.message || `Box API error: ${response.status}`)
  },

  outputs: {
    deleted: { type: 'boolean', description: 'Whether the folder was successfully deleted' },
    message: { type: 'string', description: 'Success confirmation message' },
  },
}
