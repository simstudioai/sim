import type { ToolConfig, ToolResponse } from '@/tools/types'
import type { BoxDeleteFileParams } from './types'

export const boxDeleteFileTool: ToolConfig<BoxDeleteFileParams, ToolResponse> = {
  id: 'box_delete_file',
  name: 'Box Delete File',
  description: 'Delete a file from Box',
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
    fileId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the file to delete',
    },
  },

  request: {
    url: (params) => `https://api.box.com/2.0/files/${params.fileId.trim()}`,
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
          message: 'File deleted successfully',
        },
      }
    }

    const data = await response.json()
    throw new Error(data.message || `Box API error: ${response.status}`)
  },

  outputs: {
    deleted: { type: 'boolean', description: 'Whether the file was successfully deleted' },
    message: { type: 'string', description: 'Success confirmation message' },
  },
}
